# Super Admin System Prompt Design

## Goal

Allow a designated QQ account (super admin) to dynamically inject a global system prompt at runtime. The injected prompt affects all subsequent user conversations across the entire plugin instance until cleared or changed.

## Architecture

Three layers:

1. **Config** — `superAdmin` string field in `channels.qq-personal`
2. **Store** — Isolated module (`system-prompt-store.ts`) — set/get/clear in memory
3. **Channel integration** — `channel.ts` detects admin commands, updates the store, and prepends the stored prompt into `BodyForAgent` at the `finalizeInboundContext` call site

## Config

New optional field in `QQPersonalConfig` and `ResolvedQQPersonalAccount`:

```json
"qq-personal": {
  "superAdmin": "3098340041"
}
```

`resolveAccount` extracts it as:
```typescript
superAdmin: (raw.superAdmin as string | undefined) ?? '',
```

If `superAdmin` is `''` (absent or explicitly empty), the feature is silently disabled.

## How Admin Commands Reach the Handler

All messages go through `toOpenClaw()` first:

- **Private chat**: any message from the admin reaches the command check.
- **Group chat**: the admin must `@mention` the bot. `extractText` strips the `@bot` segment; the remaining text must start with `小V `. Example: admin sends `@bot 小V 你是Python助手` → extracted text = `小V 你是Python助手`.
- **Group chat without @mention**: `toOpenClaw()` returns `null`; exits at `if (!inbound) return`. Silently ignored — correct behavior.

## Command Protocol

The **outer trigger** is: `account.superAdmin !== ''` AND `inbound.senderId === account.superAdmin` AND `inbound.text.startsWith('小V ')` (prefix + at least one space).

`小V` with **no trailing space** does NOT satisfy `startsWith('小V ')` and is treated as a normal conversation message.

Within the triggered block, parse the content after `'小V '`:

| `inbound.text` | Parsed content | Action |
|----------------|---------------|--------|
| `小V 清除` | `'清除'` | Clear stored prompt; send `✅ 系统提示已清除` |
| `小V 你是Python助手` | `'你是Python助手'` | Store prompt; send `✅ 系统提示已设置` |
| `小V ` (trailing space, nothing after) | `''` (empty after trim) | Send `⚠️ 请在"小V"后输入指令内容`; no store change |
| `小V` (no space) | — (trigger not matched) | Normal conversation; prompt injected if set |
| Any other admin text | — (trigger not matched) | Normal conversation; prompt injected if set |
| `小V …` from non-admin | — (senderId ≠ superAdmin) | Ordinary user message; no special handling |

**Rate limiting**: The admin command check runs before the rate-limit check, so admin commands (`小V …`) are never blocked by the limiter. However, the super admin has no implicit rate-limit exemption for non-command messages — those go through the normal whitelist/rate-limit flow. If the admin's QQ is in `allowFrom`, they are exempt from rate limits entirely (existing behavior). If not, non-command admin messages are rate-limited just like any other non-whitelisted user.

Admin command replies are sent via `client.send(toOneBot(confirmationText, { type: inbound.type, peerId: inbound.peerId, senderId: inbound.senderId, groupReplyAt: account.groupReplyAt }))`. The reply goes to the same chat (DM → DM; group → group with `@sender`). Group confirmation is visible to all members — intentional.

## Execution Order in `channel.ts` Event Handler

```
toOpenClaw() → inbound
  ↓
① Admin command check (NEW — before rate-limit)
    superAdmin ≠ '' AND sender === superAdmin AND text.startsWith('小V ')?
    → Yes: parse content, execute command, send reply, return
    → No: continue
  ↓
② Whitelist / rate-limit check (existing)
  ↓
③ Normal dispatch flow
```

## system-prompt-store Module

```typescript
// src/system-prompt-store.ts
let _prompt: string | null = null

export function setSystemPrompt(p: string): void { _prompt = p }
export function clearSystemPrompt(): void        { _prompt = null }
export function getSystemPrompt(): string | null { return _prompt }
```

Module-level variable; reset on process restart (no persistence needed).

## Injection into BodyForAgent

Applied at the `finalizeInboundContext` call site:

```typescript
const systemPrompt = getSystemPrompt()
const bodyForAgent = systemPrompt
  ? `[系统指令]\n${systemPrompt}\n---\n${inbound.text}`
  : inbound.text

const ctxPayload = rt.reply.finalizeInboundContext({
  ...
  BodyForAgent: bodyForAgent,
  ...
})
```

Applies to all users, including the admin's own non-command messages.

## Affected Files

| File | Change |
|------|--------|
| `src/types.ts` | Add `superAdmin?: string` to `QQPersonalConfig`; add `superAdmin: string` to `ResolvedQQPersonalAccount` |
| `src/system-prompt-store.ts` | New module |
| `src/channel.ts` | Admin command check before rate-limit; prompt injection at `finalizeInboundContext`; `resolveAccount` update |
| `tests/system-prompt-store.test.ts` | Unit tests |
| `tests/channel.test.ts` | `startAccount` gains `superAdmin?: string` (default `''`); existing call sites need no update; add `clearSystemPrompt()` to `beforeEach`; add integration tests |

## Test Cases

### system-prompt-store.test.ts

- `getSystemPrompt()` returns `null` initially
- `setSystemPrompt('foo')` → `getSystemPrompt()` returns `'foo'`
- `clearSystemPrompt()` after set → `getSystemPrompt()` returns `null`

### channel.test.ts additions

**beforeEach update:**

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

**`startAccount` update:**

```typescript
async function startAccount(controller, opts: {
  rateLimitPerUserPerDay?: number
  rateLimitMessage?: string
  allowFrom?: string[]
  superAdmin?: string       // ← new, defaults to ''
} = {}) {
  const account = {
    ...
    superAdmin: opts.superAdmin ?? '',
  }
  ...
}
```

**Assertion pattern for `mockSend` text content** (mirrors existing rate-limit tests):

```typescript
const sentText = (mockSend.mock.calls[0][0].params.message as Array<{ type: string; data: { text?: string } }>)
  .map(s => s.data.text ?? '').join('')
expect(sentText).toContain('✅ 系统提示已设置')
```

**Assertion pattern for `BodyForAgent`:**

```typescript
expect(mockRuntime.channel.reply.finalizeInboundContext).toHaveBeenCalledWith(
  expect.objectContaining({ BodyForAgent: expect.stringContaining('[系统指令]') })
)
```

**Test table:**

| Test | Setup | Assertion |
|------|-------|-----------|
| Non-admin sends `小V hello` | `superAdmin: '11111'`; private event from `99999` | `dispatchReplyWithBufferedBlockDispatcher` called; `mockSend` NOT called (no confirmation) |
| Admin sends `小V 你是Python助手` | `superAdmin: '99999'`; private event from `99999` | `mockSend` called; sent text contains `✅ 系统提示已设置`; `dispatchReplyWithBufferedBlockDispatcher` NOT called |
| Admin sends `小V 清除` | same | `mockSend` called; sent text contains `✅ 系统提示已清除`; dispatch NOT called |
| Admin sends `小V ` (trailing space, no content) | `superAdmin: '99999'`; pre-set store with `setSystemPrompt('existing')`; send `小V ` | `mockSend` called with `⚠️` hint; dispatch NOT called; `getSystemPrompt()` still `'existing'` (unchanged) |
| Admin sends `小V` (no space) | `superAdmin: '99999'` | `dispatchReplyWithBufferedBlockDispatcher` called (normal flow); `mockSend` NOT called for confirmation |
| After prompt set, user sends message | `setSystemPrompt('你是Python助手')` before event | `dispatchReplyWithBufferedBlockDispatcher` called; `finalizeInboundContext` called with `BodyForAgent` containing `[系统指令]\n你是Python助手\n---\n` |
| After prompt cleared, user sends message | `setSystemPrompt('foo')` then `clearSystemPrompt()` before event | `finalizeInboundContext` called with `BodyForAgent` equal to plain `inbound.text` |
| Admin non-command message receives injected prompt | `setSystemPrompt('foo')`; `superAdmin: '99999'`; admin sends `hello` | `finalizeInboundContext` called with `BodyForAgent` containing `[系统指令]` |
| Admin command bypasses rate limit | `superAdmin: '99999'`, `rateLimitPerUserPerDay: 1`, `allowFrom: []`; emit two plain `hello` events from `99999` to exhaust quota; then emit `小V 新指令` from `99999` | Third `mockSend` call contains `✅ 系统提示已设置` (not rate-limit text) |
| `superAdmin: ''` disables feature | `superAdmin: ''`; event with text `小V hello` from any sender | `dispatchReplyWithBufferedBlockDispatcher` called; `finalizeInboundContext` called with `BodyForAgent` equal to `'小V hello'` (no injection, no interception) |

## Non-Goals

- Persistence across restarts (intentionally in-memory)
- Multiple super admins (single string — YAGNI)
- Per-user or per-session prompt overrides
- Audit log of prompt changes
