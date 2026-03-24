import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { OneBotEvent, OneBotAction, OneBotResponse } from './types.js'

interface OneBotClientConfig {
  wsUrl: string
  accessToken?: string
  /** 初始重连延迟（毫秒），默认 1000。测试时可传小值避免等待。 */
  reconnectDelayMs?: number
}

interface PendingRequest {
  resolve: (r: OneBotResponse) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class OneBotClient extends EventEmitter {
  private config: OneBotClientConfig
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private _botId: string | null = null

  constructor(config: OneBotClientConfig) {
    super()
    this.config = config
  }

  get botId(): string | null {
    return this._botId
  }

  async connect(signal: AbortSignal): Promise<void> {
    const initialDelay = this.config.reconnectDelayMs ?? 1000
    let delay = initialDelay
    while (!signal.aborted) {
      try {
        await this._connectOnce(signal)
      } catch {
        // 连接失败，进入退避等待
      }
      if (signal.aborted) break

      const jitter = delay * 0.2 * (Math.random() * 2 - 1)
      const wait = Math.min(delay + jitter, 30000)
      delay = Math.min(delay * 2, 30000)

      await new Promise<void>(resolve => {
        const t = setTimeout(resolve, wait)
        signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
      })
    }
  }

  private _connectOnce(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.config.accessToken
        ? `${this.config.wsUrl}?access_token=${this.config.accessToken}`
        : this.config.wsUrl

      const ws = new WebSocket(url)
      this.ws = ws

      ws.on('open', () => {
        this.emit('ready')
      })

      ws.on('message', (data: Buffer) => {
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(data.toString()) as Record<string, unknown>
        } catch {
          return
        }

        if (parsed.self_id != null && this._botId === null) {
          this._botId = String(parsed.self_id)
        }

        const echo = parsed.echo as string | undefined
        if (echo && this.pending.has(echo)) {
          const req = this.pending.get(echo)!
          clearTimeout(req.timer)
          this.pending.delete(echo)
          req.resolve(parsed as unknown as OneBotResponse)
          return
        }

        this.emit('event', parsed as unknown as OneBotEvent)
      })

      ws.on('close', () => {
        this._rejectAllPending(new Error('WebSocket closed'))
        this.emit('close')
        resolve()
      })

      ws.on('error', (err) => {
        this.emit('error', err)
        reject(err)
      })

      signal.addEventListener('abort', () => {
        this._rejectAllPending(new Error('Aborted'))
        ws.close()
        resolve()
      }, { once: true })
    })
  }

  async send(action: OneBotAction): Promise<OneBotResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }
    const echo = `echo-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const payload = { ...action, echo }

    return new Promise<OneBotResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        reject(new Error(`echo timeout: ${echo}`))
      }, 10000)
      this.pending.set(echo, { resolve, reject, timer })
      this.ws!.send(JSON.stringify(payload))
    })
  }

  private _rejectAllPending(err: Error) {
    for (const [, req] of this.pending) {
      clearTimeout(req.timer)
      req.reject(err)
    }
    this.pending.clear()
  }
}
