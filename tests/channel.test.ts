import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

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
async function startAccount(controller: AbortController) {
  // 动态 import 保证 mock 先于模块加载
  const { qqPersonalPlugin } = await import('../src/channel.js')
  const account = {
    accountId: 'default', enabled: true,
    wsUrl: 'ws://127.0.0.1:3001', accessToken: '',
    groupPolicy: 'at-only' as const, groupReplyAt: true,
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
    mockDispatch.mockImplementation(async ({ dispatcherOptions }: any) => {
      await dispatcherOptions.deliver({ text: 'AI reply' }, { kind: 'block' })
    })
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
})
