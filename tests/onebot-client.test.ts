import { describe, it, expect, afterEach } from 'vitest'
import { WebSocketServer, WebSocket } from 'ws'
import { OneBotClient } from '../src/onebot-client.js'

async function waitUntil(fn: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error('waitUntil timeout')
}

const servers: WebSocketServer[] = []
const controllers: AbortController[] = []

afterEach(async () => {
  for (const c of controllers) c.abort()
  controllers.length = 0
  await Promise.all(servers.map(s => new Promise<void>(r => s.close(() => r()))))
  servers.length = 0
})

function makeServer(port: number): WebSocketServer {
  const s = new WebSocketServer({ port })
  servers.push(s)
  return s
}

function makeClient(port: number, opts?: { reconnectDelayMs?: number }): { client: OneBotClient; controller: AbortController } {
  const controller = new AbortController()
  controllers.push(controller)
  const client = new OneBotClient({
    wsUrl: `ws://127.0.0.1:${port}`,
    reconnectDelayMs: opts?.reconnectDelayMs ?? 50, // 测试用短延迟
  })
  return { client, controller }
}

describe('OneBotClient', () => {
  it('emits ready and captures botId from first event self_id', async () => {
    const server = makeServer(13001)
    server.on('connection', ws => {
      ws.send(JSON.stringify({ post_type: 'meta_event', self_id: 12345, time: 1 }))
    })

    const { client, controller } = makeClient(13001)
    const readyPromise = new Promise<void>(r => client.once('ready', r))
    client.connect(controller.signal)

    await readyPromise
    await waitUntil(() => client.botId !== null)
    expect(client.botId).toBe('12345')
  })

  it('emits event when server pushes a message', async () => {
    const server = makeServer(13002)
    let serverConn: WebSocket | null = null
    server.on('connection', ws => { serverConn = ws })

    const { client, controller } = makeClient(13002)
    const eventPromise = new Promise<Record<string, unknown>>(r => client.once('event', r))
    client.connect(controller.signal)

    await waitUntil(() => serverConn !== null)
    serverConn!.send(JSON.stringify({
      post_type: 'message', message_type: 'private',
      self_id: 1, user_id: 2, time: 1,
      message: [{ type: 'text', data: { text: 'hi' } }],
    }))

    const event = await eventPromise
    expect(event.post_type).toBe('message')
  })

  it('send() resolves with server response matched by echo', async () => {
    const server = makeServer(13003)
    server.on('connection', ws => {
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString())
        ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 42 }, echo: msg.echo }))
      })
    })

    const { client, controller } = makeClient(13003)
    const readyPromise = new Promise<void>(r => client.once('ready', r))
    client.connect(controller.signal)
    await readyPromise

    const response = await client.send({ action: 'send_private_msg', params: { user_id: 99, message: [] } })
    expect(response.status).toBe('ok')
    expect(response.data?.message_id).toBe(42)
  })

  it('automatically reconnects after server closes the connection', async () => {
    const server = makeServer(13004)
    let connCount = 0
    server.on('connection', ws => {
      connCount++
      if (connCount === 1) setTimeout(() => ws.close(), 30)
    })

    const { client, controller } = makeClient(13004, { reconnectDelayMs: 50 })
    const readyPromise = new Promise<void>(r => client.once('ready', r))
    client.connect(controller.signal)
    await readyPromise

    await waitUntil(() => connCount >= 2, 3000)
    expect(connCount).toBeGreaterThanOrEqual(2)
  })

  it('does not reconnect after AbortSignal is aborted', async () => {
    const server = makeServer(13005)
    let connCount = 0
    server.on('connection', () => { connCount++ })

    const { client, controller } = makeClient(13005)
    const readyPromise = new Promise<void>(r => client.once('ready', r))
    client.connect(controller.signal)
    await readyPromise

    controller.abort()
    await new Promise(r => setTimeout(r, 200))
    expect(connCount).toBe(1)
  })
})
