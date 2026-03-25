import { describe, it, expect, beforeEach } from 'vitest'
import { setSystemPrompt, clearSystemPrompt, getSystemPrompt } from '../src/system-prompt-store.js'

describe('system-prompt-store', () => {
  beforeEach(() => {
    clearSystemPrompt()
  })

  it('returns null initially', () => {
    expect(getSystemPrompt()).toBeNull()
  })

  it('returns the stored prompt after set', () => {
    setSystemPrompt('你是Python助手')
    expect(getSystemPrompt()).toBe('你是Python助手')
  })

  it('returns null after clear', () => {
    setSystemPrompt('foo')
    clearSystemPrompt()
    expect(getSystemPrompt()).toBeNull()
  })
})
