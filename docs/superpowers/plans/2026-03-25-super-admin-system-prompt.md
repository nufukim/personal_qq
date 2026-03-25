# Super Admin System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a designated QQ account (super admin) to inject a global system prompt at runtime via `小V <content>` commands, affecting all subsequent user conversations until cleared.

**Architecture:** Three-layer design — config (`superAdmin` field in `qq-personal`), in-memory store module (`system-prompt-store.ts`), and channel integration (`channel.ts`) that detects admin commands before rate-limiting and prepends the stored prompt into `BodyForAgent` at `finalizeInboundContext`.

**Tech Stack:** TypeScript, vitest, OpenClaw plugin SDK, OneBot v11

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `superAdmin?: string` to `QQPersonalConfig`; add `superAdmin: string` to `ResolvedQQPersonalAccount` |
| `src/system-prompt-store.ts` | Create | In-memory singleton: `setSystemPrompt`, `clearSystemPrompt`, `getSystemPrompt` |
| `src/channel.ts` | Modify | `resolveAccount` reads `superAdmin`; admin command check before rate-limit; `BodyForAgent` injection at `finalizeInboundContext` |
| `tests/system-prompt-store.test.ts` | Create | Unit tests for store module |
| `tests/channel.test.ts` | Modify | Add `superAdmin` to `startAccount` helper; `clearSystemPrompt()` in `beforeEach`; add 9 integration tests |

---

### Task 1: Add `superAdmin` to types and `resolveAccount`

**Files:**
- Modify: `src/types.ts:49-72`
- Modify: `src/channel.ts:11-25` (`resolveAccount` function)

No new test file needed — `resolveAccount` is implicitly tested through the integration tests in Task 3.

- [ ] **Step 1: Add `superAdmin` to `QQPersonalConfig` in `src/types.ts`**

  In `src/types.ts`, add `superAdmin?: string` to `QQPersonalConfig` (after `allowFrom`):

  ```typescript
  export interface QQPersonalConfig {
    enabled?: boolean
    wsUrl?: string
    accessToken?: string
    groupPolicy?: 'at-only' | 'open'
    groupReplyAt?: boolean
    rateLimitPerUserPerDay?: number
    rateLimitMessage?: string
    allowFrom?: string[]
    superAdmin?: string
  }
  ```

- [ ] **Step 2: Add `superAdmin` to `ResolvedQQPersonalAccount` in `src/types.ts`**

  In `src/types.ts`, add `superAdmin: string` to `ResolvedQQPersonalAccount` (after `allowFrom`):

  ```typescript
  export interface ResolvedQQPersonalAccount {
    accountId: string
    enabled: boolean
    wsUrl: string
    accessToken: string
    groupPolicy: 'at-only' | 'open'
    groupReplyAt: boolean
    rateLimitPerUserPerDay: number
    rateLimitMessage: string
    allowFrom: string[]
    superAdmin: string
    config?: QQPersonalConfig
  }
  ```

- [ ] **Step 3: Update `resolveAccount` in `src/channel.ts` to extract `superAdmin`**

  In `resolveAccount` (lines 11–25), add the `superAdmin` field after `allowFrom`:

  ```typescript
  function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedQQPersonalAccount {
    const raw = (cfg.channels?.['qq-personal'] ?? {}) as Record<string, unknown>
    return {
      accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      enabled: (raw.enabled as boolean | undefined) ?? false,
      wsUrl: (raw.wsUrl as string | undefined) ?? 'ws://127.0.0.1:3001',
      accessToken: (raw.accessToken as string | undefined) ?? '',
      groupPolicy: ((raw.groupPolicy as string | undefined) ?? 'at-only') as 'at-only' | 'open',
      groupReplyAt: (raw.groupReplyAt as boolean | undefined) ?? true,
      rateLimitPerUserPerDay: (raw.rateLimitPerUserPerDay as number | undefined) ?? 0,
      rateLimitMessage: (raw.rateLimitMessage as string | undefined) ?? DEFAULT_RATE_LIMIT_MESSAGE,
      allowFrom: (raw.allowFrom as string[] | undefined) ?? [],
      superAdmin: (raw.superAdmin as string | undefined) ?? '',
      config: raw as never,
    }
  }
  ```

- [ ] **Step 4: Run type check to verify no errors**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx tsc --noEmit
  ```

  Expected: no errors

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal
  git add src/types.ts src/channel.ts
  git commit -m "feat: add superAdmin field to types and resolveAccount"
  ```

---

### Task 2: Create `system-prompt-store.ts` with TDD

**Files:**
- Create: `src/system-prompt-store.ts`
- Create: `tests/system-prompt-store.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `tests/system-prompt-store.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach } from 'vitest'
  import { setSystemPrompt, clearSystemPrompt, getSystemPrompt } from '../src/system-prompt-store.js'

  describe('system-prompt-store', () => {
    beforeEach(() => {
      clearSystemPrompt()
    })

    it('returns null initially', () => {
      expect(getSystemPrompt()).toBeNull()
    })

    it('returns the stored prompt after set', () => {
      setSystemPrompt('你是Python助手')
      expect(getSystemPrompt()).toBe('你是Python助手')
    })

    it('returns null after clear', () => {
      setSystemPrompt('foo')
      clearSystemPrompt()
      expect(getSystemPrompt()).toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run tests/system-prompt-store.test.ts
  ```

  Expected: 3 tests FAIL — module not found

- [ ] **Step 3: Create `src/system-prompt-store.ts`**

  ```typescript
  let _prompt: string | null = null

  export function setSystemPrompt(p: string): void { _prompt = p }
  export function clearSystemPrompt(): void        { _prompt = null }
  export function getSystemPrompt(): string | null { return _prompt }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run tests/system-prompt-store.test.ts
  ```

  Expected: 3 tests PASS

- [ ] **Step 5: Run full test suite to check no regressions**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run
  ```

  Expected: all existing tests PASS

- [ ] **Step 6: Commit**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal
  git add src/system-prompt-store.ts tests/system-prompt-store.test.ts
  git commit -m "feat: add system-prompt-store module with TDD"
  ```

---

### Task 3: Add admin command detection to `channel.ts`

**Files:**
- Modify: `src/channel.ts` (event handler — add admin check block before rate-limit)
- Modify: `tests/channel.test.ts` (update `startAccount` helper; update `beforeEach`; add 7 tests)

Admin command check runs **before** the rate-limit block (currently at line ~103 in `channel.ts`). The check intercepts the event, replies, and returns early — so rate-limit code never runs for commands.

- [ ] **Step 1: Write the failing tests in `tests/channel.test.ts`**

  **1a. Update `startAccount` helper** — add `superAdmin?: string` option (default `''`):

  Replace the current `startAccount` signature and `account` object:

  ```typescript
  async function startAccount(
    controller: AbortController,
    opts: {
      rateLimitPerUserPerDay?: number
      rateLimitMessage?: string
      allowFrom?: string[]
      superAdmin?: string
    } = {},
  ) {
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
    qqPersonalPlugin.gateway!.startAccount!({ account, accountId: 'default', cfg, abortSignal: controller.signal } as any)
    await new Promise(r => setTimeout(r, 20))
  }
  ```

  **1b. Update `beforeEach`** — add `clearSystemPrompt()`:

  ```typescript
  import { clearSystemPrompt } from '../src/system-prompt-store.js'

  beforeEach(() => {
    controller = new AbortController()
    vi.clearAllMocks()
    clearSystemPrompt()
    mockDispatch.mockImplementation(async ({ dispatcherOptions }: any) => {
      await dispatcherOptions.deliver({ text: 'AI reply' }, { kind: 'block' })
    })
  })
  ```

  **1c. Add 6 new tests** at the end of the `describe` block:

  ```typescript
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

  it('admin sends 小V (trailing space, no content) — sends warning, no store change', async () => {
    const { setSystemPrompt, getSystemPrompt } = await import('../src/system-prompt-store.js')
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
    expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ message: expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ text: expect.stringContaining('✅') }) })]) })
    }))
  })

  it('superAdmin empty string disables feature — 小V treated as normal message, no injection', async () => {
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

  it('admin command bypasses rate limit', async () => {
    await startAccount(controller, { superAdmin: '99999', rateLimitPerUserPerDay: 1, allowFrom: [] })
    const helloEvent = {
      post_type: 'message', message_type: 'private',
      self_id: 12345, user_id: 99999, time: 1,
      message: [{ type: 'text', data: { text: 'hello' } }],
    }
    // Send 1 normal message — exhausts the limit
    mockClientInstance.emit('event', helloEvent)
    await new Promise(r => setTimeout(r, 50))
    vi.clearAllMocks()
    // Send another normal message — hits the rate limit
    mockClientInstance.emit('event', helloEvent)
    await new Promise(r => setTimeout(r, 50))
    expect(mockRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled()
    vi.clearAllMocks()
    // Send 小V command — must succeed despite rate limit
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
  ```

- [ ] **Step 2: Run new tests to verify they fail**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run tests/channel.test.ts
  ```

  Expected: 6 new tests FAIL; existing tests PASS

- [ ] **Step 3: Add import and admin command check to `src/channel.ts`**

  **3a. Add import at top of `src/channel.ts`** (after existing imports):

  ```typescript
  import { setSystemPrompt, clearSystemPrompt, getSystemPrompt } from './system-prompt-store.js'
  ```

  **3b. Add admin command check in the event handler**, immediately after `if (!inbound) return` and before the `try` block containing the rate-limit check.

  Insert this block between `if (!inbound) return` and `try {`:

  ```typescript
  // 超级管理员指令检查（在限流检查之前）
  if (account.superAdmin !== '' && inbound.senderId === account.superAdmin && inbound.text.startsWith('小V ')) {
    const content = inbound.text.slice('小V '.length).trim()
    let confirmationText: string
    if (content === '清除') {
      clearSystemPrompt()
      confirmationText = '✅ 系统提示已清除'
    } else if (content === '') {
      confirmationText = '⚠️ 请在"小V"后输入指令内容'
    } else {
      setSystemPrompt(content)
      confirmationText = '✅ 系统提示已设置'
    }
    try {
      await client.send(toOneBot(confirmationText, {
        type: inbound.type,
        peerId: inbound.peerId,
        senderId: inbound.senderId,
        groupReplyAt: account.groupReplyAt,
      }))
    } catch (err) {
      log?.error(`[qq-personal] Failed to send admin command reply: ${err}`)
    }
    return
  }
  ```

- [ ] **Step 4: Run new tests to verify they pass**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run tests/channel.test.ts
  ```

  Expected: all tests (existing + 6 new) PASS

- [ ] **Step 5: Run full test suite**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run
  ```

  Expected: all tests PASS

- [ ] **Step 6: Commit**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal
  git add src/channel.ts tests/channel.test.ts
  git commit -m "feat: add super admin command detection before rate-limit"
  ```

---

### Task 4: Add `BodyForAgent` injection at `finalizeInboundContext`

**Files:**
- Modify: `src/channel.ts` (at `finalizeInboundContext` call site — lines ~142-156)
- Modify: `tests/channel.test.ts` (add 3 tests)

- [ ] **Step 1: Write the failing tests**

  Add 3 new tests at the end of the `describe` block in `tests/channel.test.ts`:

  ```typescript
  it('injects system prompt into BodyForAgent when prompt is set', async () => {
    const { setSystemPrompt } = await import('../src/system-prompt-store.js')
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
        BodyForAgent: expect.stringContaining('[系统指令]\n你是Python助手\n---\nhello'),
      })
    )
  })

  it('does NOT inject when prompt is cleared', async () => {
    const { setSystemPrompt, clearSystemPrompt: clear } = await import('../src/system-prompt-store.js')
    setSystemPrompt('foo')
    clear()
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
    const { setSystemPrompt } = await import('../src/system-prompt-store.js')
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
  ```

- [ ] **Step 2: Run new tests to verify they fail**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run tests/channel.test.ts
  ```

  Expected: 3 new tests FAIL (`BodyForAgent` is plain `inbound.text`, not injected)

- [ ] **Step 3: Update `finalizeInboundContext` call in `src/channel.ts`**

  Replace the `finalizeInboundContext` call block (currently `BodyForAgent: inbound.text`):

  ```typescript
  const systemPrompt = getSystemPrompt()
  const bodyForAgent = systemPrompt
    ? `[系统指令]\n${systemPrompt}\n---\n${inbound.text}`
    : inbound.text

  const ctxPayload = rt.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: bodyForAgent,
    RawBody: inbound.text,
    CommandBody: inbound.text,
    From: `qq-personal:${inbound.type}:${inbound.senderId}`,
    To: `qq-personal:${inbound.type}:${inbound.peerId}`,
    SessionKey: route?.sessionKey,
    AccountId: account.accountId,
    ChatType: isGroup ? 'group' : 'direct',
    SenderId: inbound.senderId,
    Provider: 'qq-personal',
    Surface: 'qq-personal',
    OriginatingChannel: 'qq-personal',
  })
  ```

- [ ] **Step 4: Run new tests to verify they pass**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run tests/channel.test.ts
  ```

  Expected: all tests PASS

- [ ] **Step 5: Run full test suite**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx vitest run
  ```

  Expected: all tests PASS

- [ ] **Step 6: Run type check**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal && npx tsc --noEmit
  ```

  Expected: no errors

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/minimax/.openclaw/extensions/qq-personal
  git add src/channel.ts tests/channel.test.ts
  git commit -m "feat: inject system prompt into BodyForAgent at finalizeInboundContext"
  ```

---

## Done

All 4 tasks complete. The feature is fully implemented and tested. Run `npx vitest run` one final time to confirm all tests green before finishing the branch.
