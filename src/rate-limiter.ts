interface DayState {
  count: number
  dayKey: string
}

export class DailyRateLimiter {
  private limits: Map<string, DayState> = new Map()

  constructor(
    private maxPerDay: number,
    private getNow: () => Date = () => new Date(),
  ) {}

  private todayKey(): string {
    return this.getNow().toISOString().slice(0, 10)
  }

  isAllowed(senderId: string): boolean {
    if (this.maxPerDay <= 0) return true
    const today = this.todayKey()
    const state = this.limits.get(senderId)
    if (!state || state.dayKey !== today) return true
    return state.count < this.maxPerDay
  }

  record(senderId: string): void {
    const today = this.todayKey()
    const state = this.limits.get(senderId)
    if (!state || state.dayKey !== today) {
      this.limits.set(senderId, { count: 1, dayKey: today })
    } else {
      this.limits.set(senderId, { count: state.count + 1, dayKey: today })
    }
  }

  getCount(senderId: string): number {
    const today = this.todayKey()
    const state = this.limits.get(senderId)
    if (!state || state.dayKey !== today) return 0
    return state.count
  }
}
