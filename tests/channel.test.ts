import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { clearSystemPrompt, getSystemPrompt, setSystemPrompt } from '../src/system-prompt-store.js'

// ===== Mock: OneBotClient =====
const mockSend = vi.fn().mockResolvedValue({ status: 'ok', retcode: 0, data: { message_id: 1 } })
let mockClientInstance: MockClient

class MockClient extends EventEmitter {
  botId: string | null = '12345'
  connect = vi.fn().mockImplementation(async (signal: AbortSignal) => {
    await new Promise<void>(r => signal.addEventListener('abort', () => r(), { once: true }))
  })
  send = mockSend
}

vi.mock('../src/onebot-client.js', () => ({
  OneBotClient: vi.fn().mockImplementation(() => {
    mockClientInstance = new MockClient()
    return mockClientInstance
  }),
}))

// ===== Mock: runtime.ts =====
// mockRuntime.channel 使用宽松结构（as any），因为真实 PluginRuntime.channel 类型非常复杂
const mockDispatch = vi.fn()
const mockRuntime = {
  channel: {
    activity: { record: vi.fn() },
    routing: {
      resolveAgentRoute: vi.fn().mockReturnValue({
        sessionKey: 'test-session',
        agentId: 'default',
        accountId: 'default',
      }),
    },
    reply: {
      resolveEnvelopeFormatOptions: vi.fn().mockReturnValue({}),
      formatInboundEnvelope: vi.fn().mockReturnValue('test message'),
      finalizeInboundContext: vi.fn().mockReturnValue({ SessionKey: 'test-session' }),
      dispatchReplyWithBufferedBlockDispatcher: mockDispatch,
    },
  },
}

vi.mock('../src/runtime.js', () => ({
  getQQPersonalRuntime: vi.fn().mockReturnValue(mockRuntime),
  setQQPersonalRuntime: vi.fn(),
}))

// ===== 辅助：启动 startAccount =====
async function startAccount(
  controller: AbortController,
  opts: {
    rateLimitPerUserPerDay?: number
    rateLimitMessage?: string
    allowFrom?: string[]
    superAdmin?: string
  } = {},
) {
  // 动态 import 保证 mock 先于模块加载
  const { qqPersonalPlugin } = await import('../src/channel.js')
  const account = {
    accountId: 'default', enabled: true,
    wsUrl: 'ws://127.0.0.1:3001', accessToken: '',
    groupPolicy: 'at-only' as const, groupReplyAt: true,
    rateLimitPerUserPerDay: opts.rateLimitPerUserPerDay ?? 0,
    rateLimitMessage: opts.rateLimitMessage ?? '今日对话次数已达上限，请明天再试',
    allowFrom: opts.allowFrom ?? [],
    superAdmin: opts.superAdmin ?? '',
  }
  const cfg = { channels: { 'qq-personal': { enabled: true, wsUrl: 'ws://127.0.0.1:3001', groupPolicy: 'at-only', groupReplyAt: true } } }
  // 不 await —— startAccount 持续运行直到 abort
  qqPersonalPlugin.gateway!.startAccount!({ account, accountId: 'default', cfg, abortSignal: controller.signal } as any)
  // 等待 MockClient 实例化并完成事件注册
  await new Promise(r => setTimeout(r, 20))
}

describe('qqPersonalPlugin.gateway.startAccount', () => {
  let controller: AbortController

  beforeEach(() => {
    controller = new AbortController()
    vi.clearAllMocks()
    clearSystemPrompt()
    mockDispatch.mockResolvedValue(undefined)
  })

  afterEach(() => {
    controller.abort()
  })

  it('dispatches when private message event is received', async () => {
    await startAccount(controller)
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'hello' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.routing.resolveAgentRoute).toHaveBeenCalled()
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
  })

  it('dispatches when group @mention event is received', async () => {
    await startAccount(controller)
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'group',
      self_id: 12345, group_id: 777, user_id: 88888, time: 1,
      message: [
        { type: 'at', data: { qq: '12345' } },
        { type: 'text', data: { text: ' hello bot' } },
      ],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.routing.resolveAgentRoute).toHaveBeenCalled()
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
  })

  it('does NOT dispatch when group message has no @mention', async () => {
    await startAccount(controller)
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'group',
      self_id: 12345, group_id: 777, user_id: 88888, time: 1,
      message: [{ type: 'text', data: { text: 'just chatting' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled()
  })

  it('calls client.send() with correct OneBot action when AI deliver fires', async () => {
    mockDispatch.mockImplementation(async ({ dispatcherOptions }: any) => {
      await dispatcherOptions.deliver({ text: 'AI reply' }, { kind: 'block' })
    })
    await startAccount(controller)
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'hi' } }],
    })
    await new Promise(r => setTimeout(r, 100))
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send_private_msg' })
    )
  })

  it('blocks dispatch and sends rate limit message when daily limit is reached', async () => {
    await startAccount(controller, { rateLimitPerUserPerDay: 1 })

    const privateEvent = {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'msg' } }],
    }

    // First message: allowed, dispatches normally
    mockClientInstance.emit('event', privateEvent)
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()

    // Second message: over limit, skips dispatch, sends rejection directly
    mockClientInstance.emit('event', privateEvent)
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send_private_msg' })
    )
    const sentParams = mockSend.mock.calls[0][0].params
    const sentText = (sentParams.message as Array<{ type: string; data: { text?: string } }>)
      .map(s => s.data.text ?? '').join('')
    expect(sentText).toContain('今日对话次数已达上限')
  })

  it('uses custom rateLimitMessage when configured', async () => {
    await startAccount(controller, { rateLimitPerUserPerDay: 1, rateLimitMessage: '已超限，明日再来' })

    const privateEvent = {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'msg' } }],
    }
    mockClientInstance.emit('event', privateEvent)
    await new Promise(r => setTimeout(r, 50))
    vi.clearAllMocks()
    mockClientInstance.emit('event', privateEvent)
    await new Promise(r => setTimeout(r, 50))
    const sentParams = mockSend.mock.calls[0][0].params
    const sentText = (sentParams.message as Array<{ type: string; data: { text?: string } }>)
      .map(s => s.data.text ?? '').join('')
    expect(sentText).toContain('已超限，明日再来')
  })

  it('allows all senders when allowFrom is empty (no whitelist)', async () => {
    await startAccount(controller, { allowFrom: [] })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 55555, time: 1,
      message: [{ type: 'text', data: { text: 'hi' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
  })

  it('allows whitelisted sender and dispatches normally', async () => {
    await startAccount(controller, { allowFrom: ['3098340041'] })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 3098340041, time: 1,
      message: [{ type: 'text', data: { text: 'hello' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
  })

  it('whitelisted sender bypasses daily rate limit', async () => {
    await startAccount(controller, { allowFrom: ['3098340041'], rateLimitPerUserPerDay: 1 })

    const event = {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 3098340041, time: 1,
      message: [{ type: 'text', data: { text: 'msg' } }],
    }
    // Send 2 messages — limit is 1, but whitelisted users bypass it entirely
    mockClientInstance.emit('event', event)
    await new Promise(r => setTimeout(r, 50))
    mockClientInstance.emit('event', event)
    await new Promise(r => setTimeout(r, 50))
    // Both must be dispatched to the agent
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(2)
  })

  it('non-whitelisted sender IS subject to daily rate limit', async () => {
    await startAccount(controller, { allowFrom: ['3098340041'], rateLimitPerUserPerDay: 1 })

    const event = {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'msg' } }],
    }
    // First message: allowed
    mockClientInstance.emit('event', event)
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()

    // Second message: hits rate limit
    mockClientInstance.emit('event', event)
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled()
    const sentText = (mockSend.mock.calls[0][0].params.message as Array<{ type: string; data: { text?: string } }>)
      .map((s: any) => s.data.text ?? '').join('')
    expect(sentText).toContain('今日对话次数已达上限')
  })

  it('non-whitelisted sender can interact up to the limit (not silently dropped)', async () => {
    await startAccount(controller, { allowFrom: ['3098340041'], rateLimitPerUserPerDay: 5 })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 77777, time: 1,
      message: [{ type: 'text', data: { text: 'hi' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
  })

  it('allowFrom ["*"] exempts all senders from rate limit', async () => {
    await startAccount(controller, { allowFrom: ['*'], rateLimitPerUserPerDay: 1 })

    const event = {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 77777, time: 1,
      message: [{ type: 'text', data: { text: 'hi' } }],
    }
    mockClientInstance.emit('event', event)
    await new Promise(r => setTimeout(r, 50))
    vi.clearAllMocks()
    // Second message should still go through (no rate limit with *)
    mockClientInstance.emit('event', event)
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
  })

  it('non-admin sending 小V hello is treated as normal conversation', async () => {
    await startAccount(controller, { superAdmin: '11111' })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: '小V hello' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('admin sends 小V 你是Python助手 — stores prompt and sends confirmation', async () => {
    await startAccount(controller, { superAdmin: '99999' })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: '小V 你是Python助手' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockSend).toHaveBeenCalled()
    const sentText = (mockSend.mock.calls[0][0].params.message as Array<{ type: string; data: { text?: string } }>)
      .map(s => s.data.text ?? '').join('')
    expect(sentText).toContain('✅ 系统提示已设置')
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled()
  })

  it('admin sends 小V 清除 — clears prompt and sends confirmation', async () => {
    await startAccount(controller, { superAdmin: '99999' })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: '小V 清除' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockSend).toHaveBeenCalled()
    const sentText = (mockSend.mock.calls[0][0].params.message as Array<{ type: string; data: { text?: string } }>)
      .map(s => s.data.text ?? '').join('')
    expect(sentText).toContain('✅ 系统提示已清除')
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled()
  })

  it('admin sends 小V with trailing space only — sends warning, no store change', async () => {
    setSystemPrompt('existing')
    await startAccount(controller, { superAdmin: '99999' })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: '小V ' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockSend).toHaveBeenCalled()
    const sentText = (mockSend.mock.calls[0][0].params.message as Array<{ type: string; data: { text?: string } }>)
      .map(s => s.data.text ?? '').join('')
    expect(sentText).toContain('⚠️')
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled()
    expect(getSystemPrompt()).toBe('existing')
  })

  it('admin sends 小V (no space) — falls through to normal conversation', async () => {
    await startAccount(controller, { superAdmin: '99999' })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: '小V' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
  })

  it('superAdmin empty string disables feature — 小V treated as normal message', async () => {
    await startAccount(controller, { superAdmin: '' })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: '小V hello' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalled()
    expect(mockRuntime.channel.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({ BodyForAgent: '小V hello' })
    )
  })

  it('injects system prompt into BodyForAgent when prompt is set', async () => {
    setSystemPrompt('你是Python助手')
    await startAccount(controller)
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'hello' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        BodyForAgent: '[系统指令]\n你是Python助手\n---\nhello',
      })
    )
  })

  it('does NOT inject when prompt is cleared', async () => {
    setSystemPrompt('foo')
    clearSystemPrompt()
    await startAccount(controller)
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'hello' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({ BodyForAgent: 'hello' })
    )
  })

  it('admin non-command message also receives injected prompt', async () => {
    setSystemPrompt('foo')
    await startAccount(controller, { superAdmin: '99999' })
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'hello' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        BodyForAgent: expect.stringContaining('[系统指令]'),
      })
    )
  })

  it('admin command bypasses rate limit', async () => {
    await startAccount(controller, { superAdmin: '99999', rateLimitPerUserPerDay: 1, allowFrom: [] })
    const helloEvent = {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'hello' } }],
    }
    // 1通目: 正常処理、レート制限消費
    mockClientInstance.emit('event', helloEvent)
    await new Promise(r => setTimeout(r, 50))
    vi.clearAllMocks()
    // 2通目: レート制限に引っかかる
    mockClientInstance.emit('event', helloEvent)
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled()
    vi.clearAllMocks()
    // 管理者コマンド: レート制限をバイパスして実行されるはず
    mockClientInstance.emit('event', {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: '小V 新指令' } }],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(mockSend).toHaveBeenCalled()
    const sentText = (mockSend.mock.calls[0][0].params.message as Array<{ type: string; data: { text?: string } }>)
      .map(s => s.data.text ?? '').join('')
    expect(sentText).toContain('✅ 系统提示已设置')
  })
})
