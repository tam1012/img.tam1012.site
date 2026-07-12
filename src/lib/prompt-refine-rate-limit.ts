export class PromptRefineRateLimiter {
  private entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 60_000,
    private readonly now = () => Date.now(),
  ) {}

  allow(userId: string): boolean {
    const currentTime = this.now();
    const entry = this.entries.get(userId);
    if (!entry || currentTime >= entry.resetAt) {
      this.entries.set(userId, { count: 1, resetAt: currentTime + this.windowMs });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }
}

export const promptRefineRateLimiter = new PromptRefineRateLimiter();
