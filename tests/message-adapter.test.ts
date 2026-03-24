import { describe, it, expect } from 'vitest'
import { toOpenClaw, toOneBot } from '../src/message-adapter.js'

const BOT_ID = '12345'

describe('toOpenClaw', () => {
  it('maps private message to DM with correct peerId and text', () => {
    const event = {
      post_type: 'message', message_type: 'private',
      time: 1000, self_id: 12345, user_id: 99999,
      message: [{ type: 'text', data: { text: 'hello' } }],
      raw_message: 'hello',
    }
    const result = toOpenClaw(event, BOT_ID)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('private')
    expect(result!.peerId).toBe('99999')
    expect(result!.senderId).toBe('99999')
    expect(result!.text).toBe('hello')
  })

  it('returns null for non-message events (e.g. meta_event)', () => {
    const event = { post_type: 'meta_event', time: 1000, self_id: 12345 }
    expect(toOpenClaw(event, BOT_ID)).toBeNull()
  })

  it('maps group @mention message and strips the @tag segment', () => {
    const event = {
      post_type: 'message', message_type: 'group',
      time: 1000, self_id: 12345, group_id: 777, user_id: 88888,
      message: [
        { type: 'at', data: { qq: BOT_ID } },
        { type: 'text', data: { text: ' hello bot' } },
      ],
      raw_message: '[CQ:at,qq=12345] hello bot',
    }
    const result = toOpenClaw(event, BOT_ID)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('group')
    expect(result!.peerId).toBe('777')
    expect(result!.senderId).toBe('88888')
    expect(result!.text).toBe('hello bot')
  })

  it('returns null for group message without @bot', () => {
    const event = {
      post_type: 'message', message_type: 'group',
      time: 1000, self_id: 12345, group_id: 777, user_id: 88888,
      message: [{ type: 'text', data: { text: 'not for bot' } }],
      raw_message: 'not for bot',
    }
    expect(toOpenClaw(event, BOT_ID)).toBeNull()
  })

  it('concatenates multiple text segments, ignores @bot segment', () => {
    const event = {
      post_type: 'message', message_type: 'group',
      time: 1000, self_id: 12345, group_id: 777, user_id: 88888,
      message: [
        { type: 'text', data: { text: 'hello ' } },
        { type: 'at', data: { qq: BOT_ID } },
        { type: 'text', data: { text: ' world' } },
      ],
      raw_message: 'hello [CQ:at,qq=12345] world',
    }
    const result = toOpenClaw(event, BOT_ID)
    expect(result!.text).toBe('hello world')
  })
})

describe('toOneBot', () => {
  it('generates send_private_msg with text segment for private context', () => {
    const action = toOneBot('hi there', {
      type: 'private', peerId: '99999', senderId: '99999', groupReplyAt: false,
    })
    expect(action.action).toBe('send_private_msg')
    expect(action.params.user_id).toBe(99999)
    expect(action.params.message).toEqual([{ type: 'text', data: { text: 'hi there' } }])
  })

  it('generates send_group_msg with @sender prepended when groupReplyAt=true', () => {
    const action = toOneBot('ok got it', {
      type: 'group', peerId: '777', senderId: '88888', groupReplyAt: true,
    })
    expect(action.action).toBe('send_group_msg')
    expect(action.params.group_id).toBe(777)
    const msg = action.params.message as Array<{ type: string; data: Record<string, string> }>
    expect(msg[0]).toEqual({ type: 'at', data: { qq: '88888' } })
    expect(msg[1].type).toBe('text')
    expect(msg[1].data.text).toContain('ok got it')
  })

  it('generates send_group_msg without @sender when groupReplyAt=false', () => {
    const action = toOneBot('ok got it', {
      type: 'group', peerId: '777', senderId: '88888', groupReplyAt: false,
    })
    const msg = action.params.message as Array<{ type: string }>
    expect(msg[0].type).toBe('text')
    expect(msg.some(s => s.type === 'at')).toBe(false)
  })
})
