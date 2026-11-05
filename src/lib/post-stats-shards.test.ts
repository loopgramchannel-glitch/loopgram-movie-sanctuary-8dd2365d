import { describe, expect, it } from "vitest";
import { SHARDS, shardSk } from "./post-stats.server";

describe("view/like counter shards", () => {
  it("uses 10 shards", () => expect(SHARDS).toBe(10));
  it("shard 0 keeps the original STATS row so existing totals still count", () => expect(shardSk(0)).toBe("STATS"));
  it("other shards get their own rows", () => expect(shardSk(3)).toBe("STATS#3"));
});
