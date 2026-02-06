interface Bucket {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  private readonly windowMs: number;

  private readonly maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  allow(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (now - bucket.windowStart >= this.windowMs) {
      bucket.windowStart = now;
      bucket.count = 1;
      return true;
    }

    if (bucket.count >= this.maxRequests) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.windowStart >= this.windowMs * 2) {
        this.buckets.delete(key);
      }
    }
  }
}
