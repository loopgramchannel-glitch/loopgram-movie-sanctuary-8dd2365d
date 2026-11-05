import { describe, expect, it } from "vitest";
import { isDeletableKey, uploadKey } from "@/lib/upload-keys";

describe("Studio upload destinations", () => {
  it("accepts phone MOV videos", () => {
    expect(uploadKey({ kind: "original-video" }, "video/quicktime", 1000, "abc")).toEqual({ key: "media/originals/abc.mov" });
  });
  it("puts pictures in the images folder", () => {
    expect(uploadKey({ kind: "image" }, "image/png", 1000, "p")).toEqual({ key: "media/images/p.png" });
  });
  it("rejects videos over 5 GB", () => {
    expect("error" in uploadKey({ kind: "original-video" }, "video/mp4", 5 * 1024 ** 3 + 1, "r")).toBe(true);
  });
  it("only lets Studio delete files inside media/", () => {
    expect(isDeletableKey("tmdb/w500/a.jpg")).toBe(false);
    expect(isDeletableKey("media/originals/a.mp4")).toBe(true);
    expect(isDeletableKey("media/../tmdb/x")).toBe(false);
  });
});
