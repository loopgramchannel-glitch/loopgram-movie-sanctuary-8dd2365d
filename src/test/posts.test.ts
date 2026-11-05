import { describe, expect, it } from "vitest";
import { Post, postIsEmpty, sortPosts } from "@/lib/posts";

const p = (id: string, createdAt: number, pinned = false) => Post.parse({ id, createdAt, pinned, text: "x" });

describe("owner posts", () => {
  it("pinned posts come first, then newest", () => {
    expect(sortPosts([p("aaa", 1), p("bbb", 3), p("ccc", 2, true)]).map((x) => x.id)).toEqual(["ccc", "bbb", "aaa"]);
  });
  it("a post with nothing in it is empty", () => {
    expect(postIsEmpty({ title: "", text: "", videoUrl: "", imageUrl: "" })).toBe(true);
    expect(postIsEmpty({ title: "", text: "", videoUrl: "https://x/v.mp4", imageUrl: "" })).toBe(false);
  });
});
