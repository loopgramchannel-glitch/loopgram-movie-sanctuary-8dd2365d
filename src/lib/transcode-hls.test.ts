import { describe, expect, it } from "vitest";
import { cacheControl, pickLadder, stemFor } from "../../scripts/transcode-hls";

describe("HLS transcoder rules", () => {
  it("never upscales: a 720p source gets 360p/480p/720p only", () => {
    expect(pickLadder(720).map((r) => r.name)).toEqual(["360p", "480p", "720p"]);
  });
  it("a 1080p source gets all four qualities", () => {
    expect(pickLadder(1080).map((r) => r.name)).toEqual(["360p", "480p", "720p", "1080p"]);
  });
  it("tiny sources still get a 360p rung", () => {
    expect(pickLadder(240).map((r) => r.name)).toEqual(["360p"]);
  });
  it("writes to the folders the player looks in", () => {
    expect(() => stemFor(["movie", "550"])).toThrow();
    expect(() => stemFor(["key", "../etc"])).toThrow();
    expect(stemFor(["post", "https://pub.r2.dev/media/originals/abc-1.mp4"])).toBe("media/originals/abc-1");
  });
  it("post players look exactly where the converter writes", async () => {
    const { hlsFor } = await import("./hls-attach");
    expect(hlsFor("https://pub.r2.dev/media/originals/abc-1.mp4")).toBe("https://pub.r2.dev/media/originals/abc-1/index.m3u8");
    expect(hlsFor("https://youtube.com/watch?v=x")).toBeNull();
  });
  it("video chunks are cached for a year, playlists briefly", () => {
    expect(cacheControl("360p/seg_00001.ts")).toContain("max-age=31536000");
    expect(cacheControl("index.m3u8")).toContain("max-age=60");
  });
});
