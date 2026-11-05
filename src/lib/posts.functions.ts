// Owner posts: public read + owner-only Studio writes (requireOwner on every write).
// Durable copy lives in Cloudflare D1 table `posts`; Redis `site:posts` is the fast cache.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Post, Posts, postIsEmpty, sortPosts, type PostT } from "./posts";

const tok = z.object({ token: z.string().min(20).max(4096) });

async function owner(token: string) {
  const { requireOwner, AuthError } = await import("./auth.server");
  try { return await requireOwner(token); }
  catch (e) { if (e instanceof AuthError) throw new Error(`${e.status}: ${e.message}`); throw new Error("401: Could not verify session"); }
}

async function readDurable(): Promise<PostT[] | null> {
  const { d1 } = await import("./backend.server");
  const { isPublicEligible } = await import("./owner-content");
  try {
    const r = await d1<{ body: string; status: string }>("SELECT body, status FROM posts ORDER BY created_at DESC LIMIT 5000");
    const out: PostT[] = [];
    for (const it of r.results) {
      const p = Post.safeParse(JSON.parse(it.body ?? "null"));
      // D1 status is authoritative: a REJECTED/DRAFT row can never be shown as published.
      if (p.success) out.push({ ...p.data, published: isPublicEligible(it.status, p.data.published) });
    }
    return out;
  } catch { return null; }
}

// Single-flight: when the cache is cold, concurrent requests in this instance share one D1 read.
let inflight: Promise<PostT[]> | null = null;
export async function readPosts(): Promise<PostT[]> {
  const { redis } = await import("./backend.server");
  const raw = (await redis(["GET", "site:posts"]).catch(() => null)) as string | null;
  if (typeof raw === "string") { try { return Posts.parse(JSON.parse(raw)); } catch { /* fall through */ } }
  // Redis empty, expired or down: rebuild from the permanent copy (D1 is the source of truth).
  inflight ??= (async () => {
    const d = await readDurable();
    if (d && d.length) { void redis(["SET", "site:posts", JSON.stringify(d), "EX", POSTS_TTL]).catch(() => null); return d; }
    return [];
  })().finally(() => { inflight = null; });
  return inflight;
}
// The cache expires on its own so a missed write can never hide posts for longer than this.
const POSTS_TTL = 600;
async function writeCache(list: PostT[]) {
  const { redis } = await import("./backend.server");
  const ok = await redis(["SET", "site:posts", JSON.stringify(list), "EX", POSTS_TTL]).catch(() => null);
  // Write failed: drop the old copy so readers go straight to D1 instead of a stale list.
  if (ok !== "OK") await redis(["DEL", "site:posts"]).catch(() => null);
  pub = null;
  one.clear();
}

let pub: { v: PostT[]; exp: number } | null = null;
/** Public: published posts only. Fails soft to an empty list. */
export const getPosts = createServerFn({ method: "GET" }).handler(async () => {
  if (pub && pub.exp > Date.now()) return pub.v;
  const v = sortPosts((await readPosts().catch(() => [])).filter((p) => p.published));
  pub = { v, exp: Date.now() + 15_000 };
  return v;
});

// Per-instance 15s memo for single-post checks (absorbs a viral video's burst; also memoises "not found").
const one = new Map<string, { v: PostT | null; exp: number }>();
/** Public watch page check: reads the authoritative D1 row, never the cached list,
 * so unpublished/deleted/rejected posts disappear immediately even if Redis or Algolia are stale. */
export const getPublicPost = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().regex(/^[a-z0-9-]{3,64}$/) }).parse(d))
  .handler(async ({ data }): Promise<PostT | null> => {
    const hit = one.get(data.id);
    if (hit && hit.exp > Date.now()) return hit.v;
    const { d1 } = await import("./backend.server");
    const { isPublicEligible } = await import("./owner-content");
    let v: PostT | null = null;
    try {
      const it = (await d1<{ body: string; status: string }>("SELECT body, status FROM posts WHERE id = ?1", [data.id])).results[0];
      const p = it ? Post.safeParse(JSON.parse(it.body ?? "null")) : null;
      v = it && p?.success && isPublicEligible(it.status, p.data.published) ? p.data : null;
    } catch {
      // D1 unavailable: fall back to the published list (which itself only holds eligible posts).
      v = (await readPosts().catch(() => [])).find((p) => p.id === data.id && p.published) ?? null;
    }
    if (one.size > 2000) one.clear();
    one.set(data.id, { v, exp: Date.now() + 15_000 });
    return v;
  });

export const studioPosts = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  return sortPosts(await readPosts());
});

export const studioPostSave = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ post: Post }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const { audit } = await import("./auth.server");
    const { d1, r2Probe } = await import("./backend.server");
    const { mediaKeyFromUrl, sniffMime, publishGate } = await import("./owner-content");
    const p = data.post;
    if (postIsEmpty(p)) throw new Error("400: Write something or attach a video or picture.");
    const base = process.env["R2_PUBLIC_URL"] ?? "";
    const check = async (url: string, label: string) => {
      if (!url) return null;
      const key = mediaKeyFromUrl(url, base);
      if (!key) throw new Error(`400: The ${label} must be uploaded from Studio.`);
      let probe;
      try { probe = await r2Probe(key); } catch { throw new Error(`503: Couldn't check the ${label} right now. Try again.`); }
      return { exists: probe.exists, mime: probe.head ? sniffMime(probe.head) : null };
    };
    // Video: our own upload is checked in storage; a pasted platform link must be one we know how to play.
    const { parseVideoSource } = await import("./video-source");
    const src = p.videoUrl ? parseVideoSource(p.videoUrl, { uploadBase: base || undefined }) : null;
    if (src && src.provider === "unknown") throw new Error("400: That video link isn't supported. Use YouTube, Vimeo, Dailymotion, Twitch, Streamable, Facebook or a direct .mp4 link.");
    const videoCheck = src?.provider === "loopgram" || (src && mediaKeyFromUrl(p.videoUrl, base)) ? await check(p.videoUrl, "video") : null;
    const gate = publishGate(p.published, videoCheck, await check(p.imageUrl, "picture"));
    if (gate.status === "REJECTED") {
      await audit(me, "post.rejected", `post:${p.id}`, "denied");
      const msg: Record<string, string> = {
        VIDEO_MISSING: "The video file isn't in storage yet — upload it again.",
        VIDEO_BAD_SIGNATURE: "That file isn't a real video (MP4, WebM or MOV).",
        IMAGE_MISSING: "The picture isn't in storage yet — upload it again.",
        IMAGE_BAD_SIGNATURE: "That file isn't a real picture (JPG, PNG or WebP).",
      };
      throw new Error(`400: ${msg[gate.reason!] ?? "This post couldn't be checked."}`);
    }
    // Permanent save first; only then refresh the cache. Same id = same item, so retries never duplicate.
    let changed = 0;
    try {
      const now = Date.now();
      // Out-of-order guard: an older, delayed save can never overwrite a newer one.
      const r = await d1(
        `INSERT INTO posts (id, status, body, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by
         WHERE posts.updated_at <= excluded.updated_at`,
        [p.id, gate.status, JSON.stringify(p), p.createdAt || now, now, me.uid],
      );
      changed = r.meta.changes ?? 1;
    } catch { throw new Error("502: Could not save (storage unavailable)."); }
    if (changed === 0) throw new Error("409: A newer version of this post was saved. Reload and try again.");
    const list = await readPosts();
    const exists = list.some((x) => x.id === p.id);
    await writeCache(exists ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list]);
    await audit(me, exists ? "post.update" : "post.create", `post:${p.id}`, "ok");
    // Search follows the saved state; failures go to a retry set and the next reconcile fixes them.
    const { syncPost } = await import("./algolia.server");
    const search = await syncPost(p, gate.status).catch(() => "failed");
    return { ok: true, status: gate.status, search };
  });

export const studioPostDelete = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ id: z.string().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const { audit } = await import("./auth.server");
    const { d1 } = await import("./backend.server");
    try {
      await d1("DELETE FROM posts WHERE id = ?1", [data.id]);
    } catch { throw new Error("502: Could not delete (storage unavailable)."); }
    await writeCache((await readPosts()).filter((x) => x.id !== data.id));
    const { unindexPost } = await import("./algolia.server");
    await unindexPost(data.id).catch(() => {});
    await audit(me, "post.delete", `post:${data.id}`, "ok");
    return { ok: true };
  });
