import type { ApiPermission } from '../../shared/src/index.ts';

const WINDOW_MS = 60_000; // 1 minute

export class RateLimiter {
  private windows = new Map<string, number[]>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), WINDOW_MS);
  }

  /**
   * Check and consume a rate limit slot.
   * Returns { allowed, remaining, resetAt }.
   */
  consume(
    keyId: string,
    category: ApiPermission,
    limit: number
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const key = `${keyId}:${category}`;
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Remove expired timestamps
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    const remaining = Math.max(0, limit - timestamps.length);
    const resetAt = timestamps.length > 0 ? timestamps[0] + WINDOW_MS : now + WINDOW_MS;

    if (timestamps.length >= limit) {
      return { allowed: false, remaining: 0, resetAt };
    }

    timestamps.push(now);
    return { allowed: true, remaining: remaining - 1, resetAt };
  }

  private cleanup(): void {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [key, timestamps] of this.windows) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

// Singleton
export const rateLimiter = new RateLimiter();
