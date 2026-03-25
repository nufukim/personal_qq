import { describe, it, expect } from 'vitest'
import { DailyRateLimiter } from '../src/rate-limiter.js'

describe('DailyRateLimiter', () => {
  it('allows messages under the daily limit', () => {
    const limiter = new DailyRateLimiter(3)
    expect(limiter.isAllowed('user1')).toBe(true)
    limiter.record('user1')
    expect(limiter.isAllowed('user1')).toBe(true)
    limiter.record('user1')
    expect(limiter.isAllowed('user1')).toBe(true)
    limiter.record('user1')
    expect(limiter.isAllowed('user1')).toBe(false)
  })

  it('tracks different users independently', () => {
    const limiter = new DailyRateLimiter(2)
    limiter.record('user1')
    limiter.record('user1')
    expect(limiter.isAllowed('user1')).toBe(false)
    expect(limiter.isAllowed('user2')).toBe(true)
  })

  it('resets on a new day', () => {
    let fakeDay = '2024-01-01'
    const limiter = new DailyRateLimiter(2, () => new Date(fakeDay + 'T12:00:00Z'))
    limiter.record('user1')
    limiter.record('user1')
    expect(limiter.isAllowed('user1')).toBe(false)

    fakeDay = '2024-01-02'
    expect(limiter.isAllowed('user1')).toBe(true)
  })

  it('allows all messages when maxPerDay is 0 (disabled)', () => {
    const limiter = new DailyRateLimiter(0)
    for (let i = 0; i < 100; i++) {
      expect(limiter.isAllowed('user1')).toBe(true)
      limiter.record('user1')
    }
  })

  it('getCount returns 0 for unknown user', () => {
    const limiter = new DailyRateLimiter(10)
    expect(limiter.getCount('nobody')).toBe(0)
  })

  it('getCount returns current day count', () => {
    const limiter = new DailyRateLimiter(10)
    limiter.record('user1')
    limiter.record('user1')
    expect(limiter.getCount('user1')).toBe(2)
  })

  it('getCount resets on a new day', () => {
    let fakeDay = '2024-03-01'
    const limiter = new DailyRateLimiter(10, () => new Date(fakeDay + 'T00:00:00Z'))
    limiter.record('user1')
    limiter.record('user1')
    expect(limiter.getCount('user1')).toBe(2)

    fakeDay = '2024-03-02'
    expect(limiter.getCount('user1')).toBe(0)
  })
})
