import { describe, expect, it } from "vitest";
import { parseVideoSource } from "./video-source";

describe("parseVideoSource", () => {
  it("youtube watch, short and youtu.be", () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ"])
      expect(parseVideoSource(u).provider).toBe("youtube");
  });
  it("vimeo", () => expect(parseVideoSource("https://vimeo.com/76979871").embed).toContain("player.vimeo.com/video/76979871"));
  it("dailymotion", () => expect(parseVideoSource("https://www.dailymotion.com/video/x8abcd1").provider).toBe("dailymotion"));
  it("twitch uses site as parent", () => expect(parseVideoSource("https://www.twitch.tv/videos/123456", { parent: "loopgram.com" }).embed).toContain("parent=loopgram.com"));
  it("direct mp4 plays natively", () => expect(parseVideoSource("https://cdn.example.com/a.mp4").native).toBe(true));
  it("owner upload", () => expect(parseVideoSource("https://media.x/media/a", { uploadBase: "https://media.x" }).provider).toBe("loopgram"));
  it("rejects http and random pages", () => {
    expect(parseVideoSource("http://youtu.be/dQw4w9WgXcQ").embed).toContain("https://"); // http links are upgraded to secure
    expect(parseVideoSource("https://example.com/page").provider).toBe("unknown");
  });
});

import { parseVideoSource as pvs } from "./video-source";
import { test as t2, expect as e2 } from "vitest";
t2("dailymotion variants all resolve to the same video", () => {
  for (const u of ["https://www.dailymotion.com/video/xbr7g8i", "http://dailymotion.com/video/xbr7g8i_venom", "https://dai.ly/xbr7g8i", "https://geo.dailymotion.com/player.html?video=xbr7g8i", "https://www.dailymotion.com/embed/video/xbr7g8i"])
    e2(pvs(u).embed).toBe("https://geo.dailymotion.com/player.html?video=xbr7g8i");
});
t2("x and twitter status links embed the post", () => {
  e2(pvs("https://x.com/NASA/status/1800000000000000000").provider).toBe("twitter");
  e2(pvs("https://twitter.com/NASA/status/1800000000000000000?s=20").embed).toContain("id=1800000000000000000");
  e2(pvs("https://x.com/NASA").provider).toBe("unknown");
});
