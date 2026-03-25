// OneBot v11 消息段
export type MessageSegment =
  | { type: 'text'; data: { text: string } }
  | { type: 'at'; data: { qq: string } }
  | { type: string; data: Record<string, unknown> }

// OneBot v11 事件基类
export interface OneBotEvent {
  post_type: string
  time: number
  self_id: number
}

// 私聊消息事件
export interface PrivateMessageEvent extends OneBotEvent {
  post_type: 'message'
  message_type: 'private'
  user_id: number
  message: MessageSegment[]
  raw_message: string
}

// 群消息事件
export interface GroupMessageEvent extends OneBotEvent {
  post_type: 'message'
  message_type: 'group'
  group_id: number
  user_id: number
  message: MessageSegment[]
  raw_message: string
}

// OneBot v11 动作
export interface OneBotAction {
  action: string
  params: Record<string, unknown>
  echo?: string
}

// OneBot v11 动作响应
export interface OneBotResponse {
  status: 'ok' | 'failed'
  retcode: number
  data: Record<string, unknown> | null
  echo?: string
}

// openclaw.json 中 channels.qq-personal 的配置字段
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

// 框架解析后的账号对象（由 config.resolveAccount 返回）
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
