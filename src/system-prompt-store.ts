let _prompt: string | null = null

export function setSystemPrompt(p: string): void { _prompt = p }
export function clearSystemPrompt(): void        { _prompt = null }
export function getSystemPrompt(): string | null { return _prompt }
