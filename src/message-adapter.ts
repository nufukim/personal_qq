import type { OneBotEvent, PrivateMessageEvent, GroupMessageEvent, MessageSegment, OneBotAction } from './types.js'

export interface InboundMessage {
  type: 'private' | 'group'
  peerId: string    // 私聊为对方 QQ 号，群聊为群号
  senderId: string  // 消息发送者 QQ 号
  text: string
}

export interface OutboundContext {
  type: 'private' | 'group'
  peerId: string
  senderId: string
  groupReplyAt: boolean
}

function extractText(segments: MessageSegment[], botId: string): string {
  return segments
    .filter(s => !(s.type === 'at' && (s.data as { qq: string }).qq === botId))
    .map(s => s.type === 'text' ? (s.data as { text: string }).text : '')
    .join('')
    .replace(/  +/g, ' ')
    .trim()
}

export function toOpenClaw(event: OneBotEvent, botId: string): InboundMessage | null {
  if (event.post_type !== 'message') return null

  const msgEvent = event as PrivateMessageEvent | GroupMessageEvent

  if (msgEvent.message_type === 'private') {
    const e = event as PrivateMessageEvent
    return {
      type: 'private',
      peerId: String(e.user_id),
      senderId: String(e.user_id),
      text: extractText(e.message, botId),
    }
  }

  if (msgEvent.message_type === 'group') {
    const e = event as GroupMessageEvent
    const hasMention = e.message.some(
      s => s.type === 'at' && (s.data as { qq: string }).qq === botId
    )
    if (!hasMention) return null
    return {
      type: 'group',
      peerId: String(e.group_id),
      senderId: String(e.user_id),
      text: extractText(e.message, botId),
    }
  }

  return null
}

export function toOneBot(text: string, context: OutboundContext): OneBotAction {
  if (context.type === 'private') {
    return {
      action: 'send_private_msg',
      params: {
        user_id: Number(context.peerId),
        message: [{ type: 'text', data: { text } }],
      },
    }
  }

  const message = context.groupReplyAt
    ? [
        { type: 'at', data: { qq: context.senderId } },
        { type: 'text', data: { text: ' ' + text } },
      ]
    : [{ type: 'text', data: { text } }]

  return {
    action: 'send_group_msg',
    params: {
      group_id: Number(context.peerId),
      message,
    },
  }
}
