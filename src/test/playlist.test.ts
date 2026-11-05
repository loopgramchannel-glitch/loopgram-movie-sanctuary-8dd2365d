import { describe, expect, test } from "vitest";
import { episodeNeighbors, neighbors } from "@/lib/playlist";

describe("video playlist navigation", () => {
  const list = [{ key: "a" }, { key: "b" }, { key: "c" }];
  test("next is the following distinct video", () => {
    expect(neighbors(list, (x) => x.key === "a").next?.key).toBe("b");
  });
  test("previous is the preceding video", () => {
    expect(neighbors(list, (x) => x.key === "c").prev?.key).toBe("b");
  });
  test("boundaries have no neighbour and never repeat the current video", () => {
    expect(neighbors(list, (x) => x.key === "c").next).toBeUndefined();
    expect(neighbors(list, (x) => x.key === "a").prev).toBeUndefined();
    expect(neighbors([{ key: "a" }], (x) => x.key === "a").next).toBeUndefined();
  });
});

describe("episode navigation", () => {
  const eps = [{ n: 16 }, { n: 17 }, { n: 18 }];
  test("S1 E17 next is E18, previous is E16", () => {
    const r = episodeNeighbors(1, 17, eps);
    expect(r.next).toEqual({ s: 1, e: 18 });
    expect(r.prev).toEqual({ s: 1, e: 16 });
  });
  test("last episode moves to the next season's first episode", () => {
    expect(episodeNeighbors(1, 18, eps, undefined, { n: 2, eps: [{ n: 1 }] }).next).toEqual({ s: 2, e: 1 });
  });
  test("first episode moves to the previous season's last episode", () => {
    expect(episodeNeighbors(2, 1, [{ n: 1 }], { n: 1, eps }).prev).toEqual({ s: 1, e: 18 });
  });
  test("unknown episode or missing next season gives no invented episode", () => {
    expect(episodeNeighbors(1, 99, eps)).toEqual({});
    expect(episodeNeighbors(1, 18, eps).next).toBeUndefined();
  });
});
