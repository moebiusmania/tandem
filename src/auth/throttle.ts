/**
 * Failed-login throttle keyed by client IP: after `maxFailures` consecutive failures the key is
 * blocked for `blockMs`. Failures older than `windowMs` are forgotten; a success clears the key.
 * In-memory and bounded to `maxKeys` entries.
 */
export class LoginThrottle {
  private entries = new Map<string, { failures: number; lastFailure: number; blockedUntil: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly blockMs: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Milliseconds the key is still blocked for (0 = not blocked). */
  blockedFor(key: string, now: number): number {
    const e = this.entries.get(key);
    return e && e.blockedUntil > now ? e.blockedUntil - now : 0;
  }

  /** Record a failure. Returns how many attempts remain and, when this failure triggers it, the block length. */
  fail(key: string, now: number): { remaining: number; blockedMs: number } {
    let e = this.entries.get(key);
    if (!e || e.blockedUntil > 0 || now - e.lastFailure >= this.windowMs) {
      // New key, a block that has run out, or stale failures: start counting afresh.
      if (!e && this.entries.size >= this.maxKeys) this.prune(now);
      e = { failures: 0, lastFailure: now, blockedUntil: 0 };
      this.entries.set(key, e);
    }
    e.failures++;
    e.lastFailure = now;
    if (e.failures >= this.maxFailures) {
      e.blockedUntil = now + this.blockMs;
      return { remaining: 0, blockedMs: this.blockMs };
    }
    return { remaining: this.maxFailures - e.failures, blockedMs: 0 };
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  prune(now: number): void {
    for (const [k, e] of this.entries) {
      if (e.blockedUntil <= now && now - e.lastFailure >= this.windowMs) this.entries.delete(k);
    }
    // Still full of live entries: drop the oldest to bound memory.
    while (this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value!);
  }
}

/** "2 minutes", "1 minute", "45 seconds" */
export function humanDuration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}
