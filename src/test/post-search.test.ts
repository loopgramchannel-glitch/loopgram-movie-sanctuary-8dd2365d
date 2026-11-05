import { describe, expect, test } from "vitest";
import { postRecord } from "@/lib/search-index";

const p = { id: "my-post", title: "Hello", text: "World", category: "news", imageUrl: "", videoUrl: "https://x/v.mp4", createdAt: 1 };

describe("owner posts in search", () => {
  test("published posts are indexed with a stable id (no duplicates)", () => {
    expect(postRecord(p, "PUBLISHED")?.objectID).toBe("post:my-post");
    expect(postRecord({ ...p, title: "Edited" }, "PUBLISHED")?.objectID).toBe("post:my-post");
  });
  test("drafts, rejected and deleted posts are never indexed", () => {
    for (const s of ["DRAFT", "REJECTED", "QUARANTINED", "DELETED"]) expect(postRecord(p, s)).toBeNull();
  });
  test("html is stripped from searchable text", () => {
    expect(postRecord({ ...p, title: "<script>x</script>Hi" }, "PUBLISHED")?.title).toBe("xHi");
  });
});
