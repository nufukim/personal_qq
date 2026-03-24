import type { ChannelPlugin, OpenClawConfig } from 'openclaw/plugin-sdk'
import type { ResolvedQQPersonalAccount } from './types.js'
import { OneBotClient } from './onebot-client.js'
import { toOpenClaw, toOneBot } from './message-adapter.js'
import { getQQPersonalRuntime } from './runtime.js'

const DEFAULT_ACCOUNT_ID = 'default'

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedQQPersonalAccount {
  const raw = (cfg.channels?.['qq-personal'] ?? {}) as Record<string, unknown>
  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    enabled: (raw.enabled as boolean | undefined) ?? false,
    wsUrl: (raw.wsUrl as string | undefined) ?? 'ws://127.0.0.1:3001',
    accessToken: (raw.accessToken as string | undefined) ?? '',
    groupPolicy: ((raw.groupPolicy as string | undefined) ?? 'at-only') as 'at-only' | 'open',
    groupReplyAt: (raw.groupReplyAt as boolean | undefined) ?? true,
    config: raw as never,
  }
}

export const qqPersonalPlugin: ChannelPlugin<ResolvedQQPersonalAccount> = {
  id: 'qq-personal',

  meta: {
    id: 'qq-personal',
    label: 'QQ Personal',
    selectionLabel: 'QQ Personal Account',
    blurb: 'Connect to personal QQ account via NapCatQQ (OneBot v11)',
    order: 60,
  },

  capabilities: {
    chatTypes: ['direct', 'group'],
    media: false,
    reactions: false,
    threads: false,
    blockStreaming: false,
  },

  reload: { configPrefixes: ['channels.qq-personal'] },

  config: {
    listAccountIds: (_cfg) => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    defaultAccountId: (_cfg) => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => Boolean(account?.wsUrl),
    describeAccount: (account) => ({
      accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
      enabled: account?.enabled ?? false,
      configured: Boolean(account?.wsUrl),
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      // ctx.abortSignal 是 SDK 的标准字段名（GatewayStartContext.abortSignal）
      const { account, cfg, log } = ctx
      const abortSignal = (ctx as any).abortSignal as AbortSignal

      log?.info(`[qq-personal] Starting — wsUrl=${account.wsUrl}`)
      if (account.groupPolicy === 'open') {
        log?.warn('[qq-personal] groupPolicy: "open" is not yet implemented — using "at-only" behavior')
      }

      const client = new OneBotClient({
        wsUrl: account.wsUrl,
        accessToken: account.accessToken || undefined,
      })

      // pluginRuntime.channel 使用 any —— 真实框架运行时类型非常复杂，本地无法完全重现
      const pluginRuntime = getQQPersonalRuntime()
      const rt = (pluginRuntime as any).channel

      client.on('event', async (event) => {
        const botId = client.botId
        if (!botId) return

        const inbound = toOpenClaw(event, botId)
        if (!inbound) return

        try {
          rt.activity.record({
            channel: 'qq-personal',
            accountId: account.accountId,
            direction: 'inbound',
          })

          const isGroup = inbound.type === 'group'
          const route = rt.routing.resolveAgentRoute({
            cfg,
            channel: 'qq-personal',
            accountId: account.accountId,
            peer: { kind: isGroup ? 'group' : 'direct', id: inbound.peerId },
          })

          const envelopeOptions = rt.reply.resolveEnvelopeFormatOptions(cfg)
          const body = rt.reply.formatInboundEnvelope({
            ...envelopeOptions,
            text: inbound.text,
            senderId: inbound.senderId,
            channel: 'qq-personal',
          })

          const ctxPayload = rt.reply.finalizeInboundContext({
            Body: body,
            BodyForAgent: inbound.text,
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

          await rt.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg,
            dispatcherOptions: {
              deliver: async (payload: any, _info: any) => {
                const text = (payload.text as string | undefined) ?? ''
                if (!text) return
                const action = toOneBot(text, {
                  type: inbound.type,
                  peerId: inbound.peerId,
                  senderId: inbound.senderId,
                  groupReplyAt: account.groupReplyAt,
                })
                try {
                  await client.send(action)
                } catch (err) {
                  log?.error(`[qq-personal] Failed to send reply: ${err}`)
                }
              },
            },
          })
        } catch (err) {
          log?.error(`[qq-personal] Error handling message: ${err}`)
        }
      })

      await client.connect(abortSignal)
    },
  },
}
