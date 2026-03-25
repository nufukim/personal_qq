# qq-personal

[OpenClaw](https://openclaw.ai) plugin — connects a personal QQ account to the OpenClaw AI agent via [NapCatQQ](https://github.com/NapNeko/NapCatQQ) (OneBot v11 WebSocket).

## Prerequisites

- OpenClaw installed and configured
- NapCatQQ running with OneBot v11 WebSocket server enabled (default: `ws://127.0.0.1:3001`)

## Installation

```bash
# In your OpenClaw extensions directory
cd ~/.openclaw/extensions
git clone <repo-url> qq-personal
npm install --prefix qq-personal
```

Then register the plugin in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/Users/<you>/.openclaw/extensions/qq-personal"]
    },
    "entries": {
      "qq-personal": { "enabled": true }
    }
  }
}
```

## Configuration

Add a `qq-personal` block under `channels` in `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "qq-personal": {
      "enabled": true,
      "wsUrl": "ws://127.0.0.1:3001",
      "accessToken": "",
      "groupPolicy": "at-only",
      "groupReplyAt": true,
      "rateLimitPerUserPerDay": 20,
      "rateLimitMessage": "今日对话次数已达上限，请明天再试",
      "allowFrom": [],
      "superAdmin": ""
    }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable the channel |
| `wsUrl` | `ws://127.0.0.1:3001` | NapCatQQ WebSocket URL |
| `accessToken` | `""` | OneBot access token (leave empty if not set in NapCatQQ) |
| `groupPolicy` | `"at-only"` | Group message policy. Only `at-only` is supported (bot responds only when @mentioned) |
| `groupReplyAt` | `true` | @mention the sender in group replies |
| `rateLimitPerUserPerDay` | `0` | Max messages per user per day. `0` = unlimited |
| `rateLimitMessage` | `"今日对话次数已达上限，请明天再试"` | Message sent when rate limit is hit |
| `allowFrom` | `[]` | QQ numbers exempt from rate limit. Use `["*"]` to exempt everyone |
| `superAdmin` | `""` | QQ number of the super admin. Empty string disables the feature |

## Features

### Private & Group Chat

- **Private chat**: the bot responds to all messages
- **Group chat** (`at-only`): the bot responds only when @mentioned

### Rate Limiting

Limit how many messages each user can send per day. Users in `allowFrom` bypass the limit entirely.

```json
"rateLimitPerUserPerDay": 20,
"allowFrom": ["1234567890"]
```

### Super Admin System Prompt

A designated QQ account can dynamically set a global system prompt that affects all subsequent conversations, until cleared or changed. The prompt is injected as a true system-level instruction.

**Setup:** set `superAdmin` to a QQ number:

```json
"superAdmin": "1234567890"
```

**Commands** (send in private chat, or @bot in a group):

| Message | Action |
|---------|--------|
| `小V <content>` | Set system prompt to `<content>` |
| `小V 清除` | Clear the current system prompt |
| `小V ` (trailing space, no content) | Shows a warning; no change |
| `小V` (no space) | Treated as a normal conversation message |

Notes:
- Admin commands bypass the daily rate limit
- The prompt is in-memory only — it resets on process restart
- Non-admin users sending `小V` are treated as ordinary messages

## Development

```bash
npm install
npm test          # run all tests
npm run test:watch  # watch mode
```

## Architecture

```
src/
  types.ts               — OneBot v11 and account type definitions
  onebot-client.ts       — WebSocket client (connects to NapCatQQ)
  message-adapter.ts     — Converts OneBot events ↔ OpenClaw inbound messages
  rate-limiter.ts        — Per-user daily rate limiter
  system-prompt-store.ts — In-memory global system prompt store
  channel.ts             — Main ChannelPlugin implementation
  runtime.ts             — Plugin runtime singleton
```
