import { describe, it, expect, beforeEach } from "vitest";
import { redisCircuitOpen, redisRecord, redisCircuitReset } from "./backend.server";

describe("redis circuit breaker", () => {
  beforeEach(() => redisCircuitReset());

  it("opens after 3 consecutive failures for 15 seconds", () => {
    const t = 1_000_000;
    redisRecord(false, t); redisRecord(false, t);
    expect(redisCircuitOpen(t)).toBe(false);
    redisRecord(false, t);
    expect(redisCircuitOpen(t + 14_999)).toBe(true);
    expect(redisCircuitOpen(t + 15_000)).toBe(false);
  });

  it("a success resets the failure count", () => {
    const t = 1_000_000;
    redisRecord(false, t); redisRecord(false, t); redisRecord(true, t); redisRecord(false, t);
    expect(redisCircuitOpen(t)).toBe(false);
  });
});
