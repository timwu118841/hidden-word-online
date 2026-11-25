import type { IncomingHttpHeaders } from "node:http";

/** Socket intent budget: a burst of 16, refilling at 8 intents per second. */
export const INTENT_BURST = 16;
export const INTENT_REFILL_PER_SECOND = 8;

/** Per-IP room creation budget (fixed one-minute window). */
export const ROOM_CREATE_PER_MINUTE = 10;
/** Per-IP room join budget (fixed one-minute window). */
export const ROOM_JOIN_PER_MINUTE = 30;

const MINUTE_MS = 60_000;

/**
 * Classic token bucket. `take()` returns false once the bucket is empty; the
 * caller maps that to `rate_limited`.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number = INTENT_BURST,
    private readonly refillPerSecond: number = INTENT_REFILL_PER_SECOND,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  take(): boolean {
    const current = this.now();
    const elapsedSeconds = (current - this.lastRefill) / 1000;
    if (elapsedSeconds > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
      this.lastRefill = current;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

interface FixedWindow {
  startedAt: number;
  count: number;
}

/** Fixed-window counter keyed by client IP. */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, FixedWindow>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = MINUTE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const current = this.now();
    const window = this.windows.get(key);
    if (window === undefined || current - window.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: current, count: 1 });
      this.prune(current);
      return true;
    }
    if (window.count >= this.limit) return false;
    window.count += 1;
    return true;
  }

  /** Keeps the map bounded without a background timer. */
  private prune(current: number): void {
    if (this.windows.size <= 1024) return;
    for (const [key, window] of this.windows) {
      if (current - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}

/** The slice of an HTTP request needed to identify a client (easy to fake in tests). */
export interface ClientAddressRequest {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string | undefined };
}

/**
 * Best-effort client IP. Proxies must opt in with `TRUST_PROXY=1`; the first
 * `x-forwarded-for` hop is used only then, because clients can spoof the header
 * on a direct connection.
 */
export function clientIp(
  request: ClientAddressRequest,
  trustProxy: boolean = process.env.TRUST_PROXY === "1",
): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = raw?.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  return request.socket.remoteAddress ?? "unknown";
}
