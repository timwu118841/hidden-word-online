import { describe, expect, it } from "vitest";
import { FixedWindowLimiter, TokenBucket, clientIp } from "../src/limits";

describe("TokenBucket", () => {
  it("allows the burst, blocks when empty and refills with elapsed time", () => {
    let now = 1_000;
    const bucket = new TokenBucket(2, 1, () => now);

    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);

    now += 1_000;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);

    now += 10_000;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });
});

describe("FixedWindowLimiter", () => {
  it("counts per key and resets after the window", () => {
    let now = 1_000;
    const limiter = new FixedWindowLimiter(2, 60_000, () => now);

    expect(limiter.allow("203.0.113.5")).toBe(true);
    expect(limiter.allow("203.0.113.5")).toBe(true);
    expect(limiter.allow("203.0.113.5")).toBe(false);
    expect(limiter.allow("203.0.113.6")).toBe(true);

    now += 59_999;
    expect(limiter.allow("203.0.113.5")).toBe(false);

    now += 1;
    expect(limiter.allow("203.0.113.5")).toBe(true);
  });
});

describe("clientIp", () => {
  it("ignores spoofable forwarding headers unless TRUST_PROXY is enabled", () => {
    const request = {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
      socket: { remoteAddress: "192.0.2.10" },
    };

    expect(clientIp(request, false)).toBe("192.0.2.10");
    expect(clientIp(request, true)).toBe("203.0.113.5");
  });

  it("falls back to the socket address and then to a placeholder", () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: "192.0.2.10" } }, true)).toBe(
      "192.0.2.10",
    );
    expect(clientIp({ headers: {}, socket: {} }, false)).toBe("unknown");
  });
});
