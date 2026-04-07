interface QueueItem<T> {
  data: T
  enqueuedAt: number
}

interface MessageQueueOptions {
  /** 每用户最大排队数（默认 5） */
  perUserLimit: number
  /** 全局最大排队数（默认 100） */
  globalLimit: number
  /** 日志函数 */
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
}

/**
 * 按用户隔离的消息队列，保证每个用户的消息按顺序处理，
 * 不同用户之间可并发。超出限制时丢弃最旧的消息。
 */
export class MessageQueue<T> {
  private queues = new Map<string, QueueItem<T>[]>()
  private processing = new Set<string>()
  private globalSize = 0
  private opts: MessageQueueOptions

  constructor(opts: Partial<MessageQueueOptions> = {}) {
    this.opts = {
      perUserLimit: opts.perUserLimit ?? 5,
      globalLimit: opts.globalLimit ?? 100,
      log: opts.log,
    }
  }

  /**
   * 将消息入队并启动处理。
   * @param userId 用户标识（私聊为 QQ 号，群聊为 群号:QQ号）
   * @param data 消息数据
   * @param handler 处理函数，返回 Promise
   */
  enqueue(userId: string, data: T, handler: (data: T) => Promise<void>): void {
    let queue = this.queues.get(userId)
    if (!queue) {
      queue = []
      this.queues.set(userId, queue)
    }

    // 全局限制：丢弃全局最旧的消息
    while (this.globalSize >= this.opts.globalLimit) {
      this.dropOldestGlobal()
    }

    // 每用户限制：丢弃该用户最旧的消息
    while (queue.length >= this.opts.perUserLimit) {
      queue.shift()
      this.globalSize--
      this.opts.log?.warn(`[queue] Dropped oldest message for user=${userId} (limit=${this.opts.perUserLimit})`)
    }

    queue.push({ data, enqueuedAt: Date.now() })
    this.globalSize++

    if (!this.processing.has(userId)) {
      this.processQueue(userId, handler)
    }
  }

  private async processQueue(userId: string, handler: (data: T) => Promise<void>): Promise<void> {
    this.processing.add(userId)
    const queue = this.queues.get(userId)

    while (queue && queue.length > 0) {
      const item = queue.shift()!
      this.globalSize--
      try {
        await handler(item.data)
      } catch {
        // handler 内部应自行处理错误
      }
    }

    this.processing.delete(userId)
    this.queues.delete(userId)
  }

  private dropOldestGlobal(): void {
    let oldestKey: string | undefined
    let oldestTime = Infinity

    for (const [key, queue] of this.queues) {
      if (queue.length > 0 && queue[0].enqueuedAt < oldestTime) {
        oldestTime = queue[0].enqueuedAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      const queue = this.queues.get(oldestKey)!
      queue.shift()
      this.globalSize--
      this.opts.log?.warn(`[queue] Dropped oldest global message from user=${oldestKey}`)
      if (queue.length === 0 && !this.processing.has(oldestKey)) {
        this.queues.delete(oldestKey)
      }
    }
  }

  get size(): number {
    return this.globalSize
  }

  get activeUsers(): number {
    return this.processing.size
  }
}
