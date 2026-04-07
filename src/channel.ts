import type { ChannelPlugin, OpenClawConfig } from 'openclaw/plugin-sdk'
import type { ResolvedQQPersonalAccount, OneBotAction } from './types.js'
import { OneBotClient } from './onebot-client.js'
import { toOpenClaw, toOneBot } from './message-adapter.js'
import { getQQPersonalRuntime } from './runtime.js'
import { DailyRateLimiter } from './rate-limiter.js'
import { MessageQueue } from './message-queue.js'
import { setSystemPrompt, clearSystemPrompt, getSystemPrompt } from './system-prompt-store.js'
import { stripMarkdown } from './markdown.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'

const MEDIA_DIR = join(homedir(), '.openclaw', 'media', 'inbound')
const MAX_MSG_LEN = 2000
const TTS_URL = 'http://127.0.0.1:8800/tts'

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }
    let cut = remaining.lastIndexOf('\n', limit)
    if (cut <= 0) cut = remaining.lastIndexOf(' ', limit)
    if (cut <= 0) cut = limit
    chunks.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).replace(/^\n/, '')
  }
  return chunks
}

async function downloadImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    await mkdir(MEDIA_DIR, { recursive: true })
    // 根据 content-type 判断扩展名，QQ 图片大多为 JPEG
    const ct = res.headers.get('content-type') || ''
    const ext = ct.includes('png') ? '.png' : '.jpg'
    const filePath = join(MEDIA_DIR, `${randomUUID()}${ext}`)
    await writeFile(filePath, buf)
    return filePath
  } catch {
    return null
  }
}

/** 调用 TTS 服务生成语音，返回 base64 编码的 WAV，失败返回 null */
async function textToVoice(text: string): Promise<string | null> {
  try {
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.toString('base64')
  } catch {
    return null
  }
}

function toOneBotVoice(base64Audio: string, context: { type: 'private' | 'group'; peerId: string }): OneBotAction {
  const message = [{ type: 'record', data: { file: `base64://${base64Audio}` } }]
  if (context.type === 'private') {
    return { action: 'send_private_msg', params: { user_id: Number(context.peerId), message } }
  }
  return { action: 'send_group_msg', params: { group_id: Number(context.peerId), message } }
}

const DEFAULT_ACCOUNT_ID = 'default'
const DEFAULT_RATE_LIMIT_MESSAGE = '今日对话次数已达上限，请明天再试'

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

export const qqPersonalPlugin: ChannelPlugin<ResolvedQQPersonalAccount> = {
  id: 'qq-personal',

  meta: {
    id: 'qq-personal',
    label: 'QQ Personal',
    selectionLabel: 'QQ Personal Account',
    blurb: 'Connect to personal QQ account via NapCatQQ (OneBot v11)',
    order: 60,
    docsPath: 'qq-personal',
  },

  capabilities: {
    chatTypes: ['direct', 'group'],
    media: true,
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

      const rateLimiter = new DailyRateLimiter(account.rateLimitPerUserPerDay)
      const messageQueue = new MessageQueue({ perUserLimit: 5, globalLimit: 100, log })

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

        // DEBUG: log raw event to diagnose wrong-@ issue
        if ((event as any).post_type === 'message') {
          const e = event as any
          log?.info(`[qq-personal] RAW EVENT: type=${e.message_type} self_id=${e.self_id}(${typeof e.self_id}) user_id=${e.user_id}(${typeof e.user_id}) group_id=${e.group_id ?? 'N/A'} segments=${JSON.stringify(e.message)}`)
        }

        const inbound = toOpenClaw(event, botId)
        if (!inbound) return

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

        // 用户维度的消息队列键：私聊用 senderId，群聊用 群号:发送者
        const queueKey = inbound.type === 'group'
          ? `${inbound.peerId}:${inbound.senderId}`
          : inbound.senderId

        messageQueue.enqueue(queueKey, inbound, async (msg) => {
        try {
          rt.activity.record({
            channel: 'qq-personal',
            accountId: account.accountId,
            direction: 'inbound',
          })

          // 白名单豁免检查：在白名单内的发送者，以及超级管理员，不受每日限额约束
          const isWhitelisted =
            account.allowFrom.includes('*') ||
            account.allowFrom.includes(inbound.senderId) ||
            (account.superAdmin !== '' && inbound.senderId === account.superAdmin)

          // 每用户每日限额检查（仅对非白名单用户生效）
          if (!isWhitelisted) {
            if (!rateLimiter.isAllowed(inbound.senderId)) {
              log?.info(`[qq-personal] Rate limit hit for sender=${inbound.senderId}`)
              const rejectAction = toOneBot(account.rateLimitMessage, {
                type: inbound.type,
                peerId: inbound.peerId,
                senderId: inbound.senderId,
                groupReplyAt: account.groupReplyAt,
              })
              try {
                await client.send(rejectAction)
              } catch (err) {
                log?.error(`[qq-personal] Failed to send rate limit reply: ${err}`)
              }
              return
            }
            rateLimiter.record(inbound.senderId)
          }

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

          const systemPrompt = getSystemPrompt()

          // 检测"语音回答"前缀并剥离
          const wantsVoice = inbound.text.startsWith('语音回答')
          const agentText = wantsVoice ? inbound.text.slice('语音回答'.length).trimStart() : inbound.text

          // 下载图片到本地，通过 MediaPaths 传给 agent
          let mediaPaths: string[] = []
          if (inbound.imageUrls.length > 0) {
            const results = await Promise.all(inbound.imageUrls.map(downloadImage))
            mediaPaths = results.filter((p): p is string => p !== null)
            if (mediaPaths.length > 0) {
              log?.info(`[qq-personal] Downloaded ${mediaPaths.length} image(s): ${mediaPaths.join(', ')}`)
            }
          }

          const bodyForAgent = mediaPaths.length > 0
            ? (agentText || '(用户发送了图片)') + '\n' + mediaPaths.map((p, i) => `[media attached ${i + 1}/${mediaPaths.length}: ${p}]`).join('\n')
            : agentText

          const ctxPayload = rt.reply.finalizeInboundContext({
            Body: body,
            BodyForAgent: bodyForAgent,
            RawBody: inbound.text,
            CommandBody: inbound.text,
            GroupSystemPrompt: systemPrompt ?? undefined,
            From: `qq-personal:${inbound.type}:${inbound.senderId}`,
            To: `qq-personal:${inbound.type}:${inbound.peerId}`,
            SessionKey: route?.sessionKey,
            AccountId: account.accountId,
            ChatType: isGroup ? 'group' : 'direct',
            SenderId: inbound.senderId,
            Provider: 'qq-personal',
            Surface: 'qq-personal',
            OriginatingChannel: 'qq-personal',
            ...(mediaPaths.length > 0 && {
              MediaPaths: mediaPaths,
              MediaTypes: mediaPaths.map(() => 'image/jpeg'),
            }),
          })

          await rt.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg,
            dispatcherOptions: {
              deliver: async (payload: any, _info: any) => {
                const raw = (payload.text as string | undefined) ?? ''
                if (!raw) return
                const text = stripMarkdown(raw)

                // 发送文字消息
                const chunks = chunkText(text, MAX_MSG_LEN)
                for (const chunk of chunks) {
                  const action = toOneBot(chunk, {
                    type: inbound.type,
                    peerId: inbound.peerId,
                    senderId: inbound.senderId,
                    groupReplyAt: account.groupReplyAt,
                  })
                  try {
                    log?.info(`[qq-personal] SEND ACTION: ${JSON.stringify(action)}`)
                    await client.send(action)
                  } catch (err) {
                    log?.error(`[qq-personal] Failed to send reply: ${err}`)
                  }
                }

                // 用户消息以"语音回答"开头时，额外发送语音
                if (wantsVoice) {
                  textToVoice(text).then(async (voiceBase64) => {
                    if (!voiceBase64) return
                    const voiceAction = toOneBotVoice(voiceBase64, {
                      type: inbound.type,
                      peerId: inbound.peerId,
                    })
                    try {
                      log?.info(`[qq-personal] SEND VOICE to ${inbound.peerId}`)
                      await client.send(voiceAction)
                    } catch (err) {
                      log?.error(`[qq-personal] Failed to send voice: ${err}`)
                    }
                  }).catch(() => {})
                }
              },
            },
          })
        } catch (err) {
          log?.error(`[qq-personal] Error handling message: ${err}`)
        }
        })
      })

      await client.connect(abortSignal)
    },
  },
}
