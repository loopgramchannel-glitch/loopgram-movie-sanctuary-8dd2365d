import { describe, it, expect } from "vitest";
import { jobKey, parseJob, backoffSeconds, failureAction, MAX_RECEIVES } from "@/lib/jobs";
import { scrub } from "@/lib/log-sanitize";
import { verifyTurnstile } from "@/lib/turnstile.server";

describe("background jobs", () => {
  it("duplicate messages share one idempotency key", () => {
    expect(jobKey({ kind: "reconcile" })).toBe(jobKey({ kind: "reconcile" }));
  });
  it("rejects malformed or unknown messages", () => {
    expect(parseJob("not json")).toBeNull();
    expect(parseJob(JSON.stringify({ v: 1, kind: "index", type: "person", id: 1 }))).toBeNull();
    expect(parseJob(JSON.stringify({ v: 1, kind: "reconcile" }))).toEqual({ v: 1, kind: "reconcile" });
  });
  it("retries transient failures, dead-letters after 5 tries or permanent errors", () => {
    expect(MAX_RECEIVES).toBe(5);
    expect(failureAction(1, false)).toBe("retry");
    expect(failureAction(5, false)).toBe("dead");
    expect(failureAction(1, true)).toBe("dead");
  });
  it("backoff grows and is capped at 15 minutes", () => {
    expect(backoffSeconds(1, 1)).toBe(10);
    expect(backoffSeconds(3, 1)).toBe(40);
    expect(backoffSeconds(20, 1)).toBe(900);
  });
});
describe("log scrubbing", () => {
  it("never keeps tokens or auth headers", () => {
    const out = JSON.stringify(scrub({ authorization: "Bearer abc", msg: "failed Bearer xyz123 url?X-Amz-Signature=deadbeef", api_key: "k" }));
    expect(out).not.toContain("abc"); expect(out).not.toContain("xyz123"); expect(out).not.toContain("deadbeef"); expect(out).not.toContain('"k"');
  });
});
describe("turnstile (real Siteverify, Cloudflare test keys)", () => {
  it("rejects a missing token without calling the provider", async () => {
    expect(await verifyTurnstile(undefined, undefined, { secret: "x" })).toEqual({ ok: false, reason: "missing-token" });
  });
  it("accepts a token with the always-pass test secret", async () => {
    expect((await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", undefined, { secret: "1x0000000000000000000000000000000AA" })).ok).toBe(true);
  });
  it("rejects with the always-fail test secret", async () => {
    expect((await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", undefined, { secret: "2x0000000000000000000000000000000AA" })).ok).toBe(false);
  });
  it("rejects a token already used (test secret for spent tokens)", async () => {
    const r = await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", undefined, { secret: "3x0000000000000000000000000000000AA" });
    expect(r).toEqual({ ok: false, reason: "timeout-or-duplicate" });
  });
});

import { coalesceStats } from "@/lib/jobs";
describe("like/view queue jobs", () => {
  it("accepts a valid like/view delta and rejects a bad one", () => {
    const ok = { v: 1, kind: "poststat", bid: "abcd1234-ef", id: "p-1", views: 1, likes: 0, dislikes: 0 };
    expect(parseJob(JSON.stringify(ok))).toEqual(ok);
    expect(parseJob(JSON.stringify({ ...ok, likes: 1.5 }))).toBeNull();
    expect(parseJob(JSON.stringify({ ...ok, bid: "x" }))).toBeNull();
  });
  it("sums many taps on one post into one write", () => {
    const j = (id: string, l: number) => ({ kind: "poststat" as const, bid: "b" + Math.random(), id, views: 1, likes: l, dislikes: 0 });
    const m = coalesceStats([j("a", 1), j("a", 1), j("a", -1), j("b", 1)]);
    expect(m.size).toBe(2);
    expect(m.get("a")).toEqual({ views: 3, likes: 1, dislikes: 0 });
  });
  it("redelivered message keeps the same idempotency key", () => {
    expect(jobKey({ kind: "poststat", bid: "same-bid-1", id: "p", views: 1, likes: 0, dislikes: 0 })).toBe("poststat:same-bid-1");
  });
});

describe("transcode jobs", () => {
  const b = (j: object) => JSON.stringify({ ...j, v: 1 });
  it("accepts owner post videos", () => {
    for (const key of ["media/originals/mvvrctde-n246.mov", "media/originals/a-1.mp4"])
      expect(parseJob(b({ kind: "transcode", key }))).not.toBeNull();
  });
  it("rejects pictures and paths outside owner video folders", () => {
    for (const key of ["media/images/a.jpg", "media/../secret.mp4", "other/550.mp4", "media/movie/550.mp4"])
      expect(parseJob(b({ kind: "transcode", key }))).toBeNull();
  });
  it("same file always maps to the same job key", () => {
    expect(jobKey({ kind: "transcode", key: "media/originals/a.mp4" })).toBe("transcode:media/originals/a.mp4");
  });
});
