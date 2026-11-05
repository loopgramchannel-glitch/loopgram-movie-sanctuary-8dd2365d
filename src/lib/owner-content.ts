// Pure rules for Source B (owner content): file signatures, safe media keys, and the publish gate.
// No I/O so every rule is unit-tested; checks against R2 happen in posts.functions.ts.

export type OwnerStatus = "DRAFT" | "PENDING_PROCESSING" | "PUBLISHED" | "REJECTED";

/** Detect the real file type from its first bytes (never trust the extension). */
export function sniffMime(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (b.length < 12) return null;
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (at(4, 0x66, 0x74, 0x79, 0x70)) { // ftyp box
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

/** Turns a public R2 URL into a bucket key, refusing anything outside the owner's media folder. */
export function mediaKeyFromUrl(url: string, publicBase: string): string | null {
  const base = publicBase.replace(/\/$/, "");
  if (!base || !url.startsWith(base + "/")) return null;
  const key = decodeURIComponent(url.slice(base.length + 1).split("?")[0] ?? "");
  if (!/^media\/[A-Za-z0-9/_.-]{1,400}$/.test(key) || key.includes("..") || key.includes("//")) return null;
  return key;
}

export type MediaCheck = { exists: boolean; mime: string | null };

/** Publish gate: a post only goes PUBLISHED when every attached file exists and really is the right kind. */
export function publishGate(
  wantsPublish: boolean,
  video: MediaCheck | null,
  image: MediaCheck | null,
): { status: OwnerStatus; reason?: string } {
  if (video) {
    if (!video.exists) return { status: "REJECTED", reason: "VIDEO_MISSING" };
    if (!video.mime?.startsWith("video/")) return { status: "REJECTED", reason: "VIDEO_BAD_SIGNATURE" };
  }
  if (image) {
    if (!image.exists) return { status: "REJECTED", reason: "IMAGE_MISSING" };
    if (!image.mime?.startsWith("image/")) return { status: "REJECTED", reason: "IMAGE_BAD_SIGNATURE" };
  }
  return { status: wantsPublish ? "PUBLISHED" : "DRAFT" };
}

/** Authoritative public eligibility: the DynamoDB state wins over any flag inside the cached body.
 * Records written before states existed (no status) fall back to the body flag. */
export function isPublicEligible(status: string | undefined, bodyPublished: boolean): boolean {
  if (status === undefined || status === "") return bodyPublished;
  return status === "PUBLISHED" && bodyPublished;
}
