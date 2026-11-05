// Pure, browser-safe helpers shared by the indexer and tests. No secrets here.
/** Index job contract: rebuild the posts index. A future SQS consumer can call the same handler. */
export type SearchJob = { kind: "reconcile" };

/** Algolia index for owner posts (the only searchable content). */
export const POSTS_INDEX = "loopgram_posts";
export type PostRecord = { objectID: string; source: "owner"; title: string; text: string; category: string; image: string | null; hasVideo: boolean; createdAt: number };
export const POSTS_INDEX_SETTINGS = {
  searchableAttributes: ["title", "unordered(text)", "category"],
  attributesForFaceting: ["category", "source"],
  customRanking: ["desc(createdAt)"],
};
const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim();
/** Only PUBLISHED posts are searchable; anything else (draft/rejected) returns null and must be removed. */
export function postRecord(p: { id: string; title: string; text: string; category: string; imageUrl: string; videoUrl: string; createdAt: number }, status: string): PostRecord | null {
  if (status !== "PUBLISHED" || !/^[a-z0-9-]{3,64}$/.test(p.id)) return null;
  const title = stripTags(p.title).slice(0, 200), text = stripTags(p.text).slice(0, 1500);
  if (!title && !text && !p.videoUrl && !p.imageUrl) return null;
  return { objectID: `post:${p.id}`, source: "owner", title, text, category: stripTags(p.category).slice(0, 40), image: p.imageUrl || null, hasVideo: Boolean(p.videoUrl), createdAt: p.createdAt };
}
