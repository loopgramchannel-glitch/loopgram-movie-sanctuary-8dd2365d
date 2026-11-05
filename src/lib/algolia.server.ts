// Server-only Algolia indexing. Uses the admin key; never import from browser code.
import { dynamo, redis } from "./backend.server";
import { POSTS_INDEX, POSTS_INDEX_SETTINGS, postRecord, type PostRecord, type SearchJob } from "./search-index";

function creds() {
  const app = process.env["ALGOLIA_APP_ID"], key = process.env["ALGOLIA_ADMIN_API_KEY"];
  if (!app || !key) throw new Error("Algolia not configured (ALGOLIA_APP_ID / ALGOLIA_ADMIN_API_KEY missing)");
  return { app, key };
}
async function algolia(method: string, path: string, body?: unknown) {
  const { app, key } = creds();
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://${app}.algolia.net${path}`, {
        method, signal: AbortSignal.timeout(8000),
        headers: { "X-Algolia-Application-Id": app, "X-Algolia-API-Key": key, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const t = await r.text();
      if (r.ok) return t ? JSON.parse(t) : {};
      last = `Algolia ${method} ${path.split("?")[0]} ${r.status}: ${t.slice(0, 200)}`;
      if (r.status < 500 && r.status !== 429) break; // permanent
    } catch (e) { last = e instanceof Error ? e.message : String(e); }
    await new Promise((res) => setTimeout(res, 200 * 2 ** attempt + Math.random() * 200));
  }
  throw new Error(last);
}
// ---- Owner posts ----
const pidx = `/1/indexes/${encodeURIComponent(POSTS_INDEX)}`;
const POST_RETRY = "lg:algolia:post-retry";

/** Upserts a PUBLISHED post or removes anything else. Same objectID every time → no duplicates. */
export async function syncPost(p: Parameters<typeof postRecord>[0], status: string) {
  const rec = postRecord(p, status);
  try {
    if (rec) await algolia("PUT", `${pidx}/${encodeURIComponent(rec.objectID)}`, rec);
    else await algolia("DELETE", `${pidx}/${encodeURIComponent(`post:${p.id}`)}`);
    await redis(["SREM", POST_RETRY, p.id]).catch(() => {});
    return rec ? "indexed" : "removed";
  } catch (e) {
    const { log } = await import("./log.server");
    log("error", "algolia.post_sync_failed", { id: p.id, error: String(e) });
    await redis(["SADD", POST_RETRY, p.id]).catch(() => {});
    return "failed";
  }
}
export const unindexPost = (id: string) => syncPost({ id, title: "", text: "", category: "", imageUrl: "", videoUrl: "", createdAt: 0 }, "DELETED");

/** Rebuilds the posts index from DynamoDB (the source of truth): published posts in, everything else out. */
export async function reconcilePosts() {
  const r = await dynamo("Query", {
    TableName: process.env["DYNAMODB_TABLE_NAME"],
    KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
    ExpressionAttributeValues: { ":p": { S: "OWNER#site" }, ":s": { S: "POST#" } },
  });
  const records: PostRecord[] = [];
  for (const it of r.Items ?? []) {
    try { const rec = postRecord(JSON.parse(it.body?.S ?? "{}"), it.status?.S ?? ""); if (rec) records.push(rec); } catch { /* skip bad row */ }
  }
  await algolia("PUT", `${pidx}/settings`, POSTS_INDEX_SETTINGS);
  await algolia("POST", `${pidx}/clear`);
  if (records.length) await algolia("POST", `${pidx}/batch`, { requests: records.map((body) => ({ action: "updateObject", body })) });
  await redis(["DEL", POST_RETRY]).catch(() => {});
  return { posts: (r.Items ?? []).length, indexed: records.length };
}

/** Single job handler — the same entry point a future SQS consumer will call. Idempotent. */
export async function handleSearchJob(job: SearchJob): Promise<unknown> {
  if (job.kind === "reconcile") return reconcilePosts();
  return null;
}

/** Re-sends posts whose earlier search update failed. */
export async function retryFailed() {
  const ids = ((await redis(["SMEMBERS", POST_RETRY])) as string[] | null) ?? [];
  if (!ids.length) return { ok: 0, failed: 0, pending: 0 };
  const r = await reconcilePosts();
  return { ok: ids.length, failed: 0, pending: 0, ...r };
}
export const applySettings = () => algolia("PUT", `${pidx}/settings`, POSTS_INDEX_SETTINGS);
