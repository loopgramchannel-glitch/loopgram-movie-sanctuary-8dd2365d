import { describe, expect, it } from "vitest";
import { formatCount, nextVote, viewsLabel, voteDelta } from "./post-stats";

describe("post stats", () => {
  it("formats counts like YouTube", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1250)).toBe("1.2K");
    expect(formatCount(12_900)).toBe("12K");
    expect(formatCount(1_500_000)).toBe("1.5M");
    expect(formatCount(3_400_000_000)).toBe("3.4B");
    expect(viewsLabel(1)).toBe("1 view");
  });
  it("tapping the same thumb twice clears the vote", () => {
    expect(nextVote(1, 1)).toBe(0);
    expect(nextVote(-1, 1)).toBe(1);
  });
  it("switching dislike to like adds one like and removes one dislike", () => {
    expect(voteDelta(-1, 1)).toEqual({ likes: 1, dislikes: -1 });
    expect(voteDelta(1, 0)).toEqual({ likes: -1, dislikes: 0 });
  });
});
