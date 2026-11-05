import { describe, expect, it } from "vitest";
import { mediaKeyFromUrl, publishGate, sniffMime } from "./owner-content";

const bytes = (...v: number[]) => { const b = new Uint8Array(16); b.set(v); return b; };
const MP4 = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const BASE = "https://media.example.com";

describe("owner uploads: file signatures", () => {
  it("recognises a real MP4 and PNG by their bytes", () => {
    expect(sniffMime(MP4)).toBe("video/mp4");
    expect(sniffMime(PNG)).toBe("image/png");
  });
  it("rejects an unsupported/disguised file", () => {
    expect(sniffMime(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull(); // .exe renamed to .mp4
  });
});

describe("owner uploads: safe storage keys", () => {
  it("accepts files inside the owner's media folder", () => {
    expect(mediaKeyFromUrl(`${BASE}/media/originals/abc.mp4`, BASE)).toBe("media/originals/abc.mp4");
  });
  it("blocks path traversal and other people's files", () => {
    expect(mediaKeyFromUrl(`${BASE}/media/../secret.txt`, BASE)).toBeNull();
    expect(mediaKeyFromUrl(`${BASE}/tmdb/w500/x.jpg`, BASE)).toBeNull();
    expect(mediaKeyFromUrl("https://evil.com/media/a.mp4", BASE)).toBeNull();
  });
});

describe("owner uploads: publish gate", () => {
  it("publishes a valid video post", () => {
    expect(publishGate(true, { exists: true, mime: "video/mp4" }, null)).toEqual({ status: "PUBLISHED" });
  });
  it("never publishes when the file is missing from storage", () => {
    expect(publishGate(true, { exists: false, mime: null }, null).status).toBe("REJECTED");
  });
  it("never publishes a picture pretending to be a video", () => {
    expect(publishGate(true, { exists: true, mime: "image/png" }, null)).toEqual({ status: "REJECTED", reason: "VIDEO_BAD_SIGNATURE" });
  });
  it("keeps unpublished posts as drafts", () => {
    expect(publishGate(false, null, { exists: true, mime: "image/png" }).status).toBe("DRAFT");
  });
});
