// Post views & likes engine. Redis (Upstash) is the live counter; Cloudflare D1 keeps the permanent total forever.
// Hot paths are batched (job queue + per-isolate buffer) so a viral video costs ~1 storage write per few seconds, not 1 per tap.
import { d1, d1Batch, redis, redisPipeline, redisPipelineChecked, type D1Stmt } from "./backend.server";
import { VIEW_DEDUPE_S, voteDelta, type PostStats, type Vote } from "./post-stats";
import { coalesceStats, type StatJob } from "./jobs";

const H = (id: string) => `ps:${id}`; // hash: v (views), l (likes), d (dislikes)
const FLUSH_MS = 5_000;

/** One atomic upsert adding deltas to a post's permanent total (D1 table post_stats). */
const addStmt = (id: string, v: number, l: number, d: number, now = Date.now()): D1Stmt => ({
  sql: `INSERT INTO post_stats (post_id, views, likes, dislikes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(post_id) DO UPDATE SET views = views + excluded.views, likes = likes + excluded.likes,
        dislikes = dislikes + excluded.dislikes, updated_at = excluded.updated_at`,
  params: [id, v, l, d, now],
});

// ---- Durable batching to D1 ----
const pending = new Map<string, { v: number; l: number; d: number }>();
let lastFlush = 0;
async function flushDurable(force = false) {
  const now = Date.now();
  if (!pending.size || (!force && now - lastFlush < FLUSH_MS)) return;
  lastFlush = now;
  const batch = [...pending]; pending.clear();
  try { await d1Batch(batch.map(([id, c]) => addStmt(id, c.v, c.l, c.d, now))); }
  catch { for (const [id, c] of batch) addPending(id, c.v, c.l, c.d); } // keep for the next flush
}
function addPending(id: string, v: number, l: number, d: number) {
  const p = pending.get(id) ?? { v: 0, l: 0, d: 0 };
  pending.set(id, { v: p.v + v, l: p.l + l, d: p.d + d });
  if (pending.size > 5000) pending.clear();
}

// ---- Local abuse limit: one isolate never lets an address hammer the counters ----
const hits = new Map<string, { n: number; t: number }>();
function allow(key: string, max: number, windowMs = 60_000) {
  const now = Date.now(); const h = hits.get(key);
  if (!h || now - h.t > windowMs) { hits.set(key, { n: 1, t: now }); if (hits.size > 20000) hits.clear(); return true; }
  return ++h.n <= max;
}

type Totals = { views: number; likes: number; dislikes: number; found: boolean };
async function readTotals(ids: string[]): Promise<Map<string, Totals>> {
  const out = new Map<string, Totals>();
  for (const id of ids) out.set(id, { views: 0, likes: 0, dislikes: 0, found: false });
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const r = await d1<{ post_id: string; views: number; likes: number; dislikes: number }>(
      `SELECT post_id, views, likes, dislikes FROM post_stats WHERE post_id IN (${chunk.map((_, n) => `?${n + 1}`).join(",")})`, chunk);
    for (const it of r.results) {
      const s = out.get(it.post_id); if (!s) continue;
      s.found = true; s.views = Number(it.views) || 0; s.likes = Number(it.likes) || 0; s.dislikes = Number(it.dislikes) || 0;
    }
  }
  return out;
}
async function dynAdd(id: string, v: number, l: number, d: number) {
  const [, r] = await d1Batch([addStmt(id, v, l, d), { sql: "SELECT views, likes FROM post_stats WHERE post_id = ?1", params: [id] }]);
  const row = (r?.results[0] ?? {}) as { views?: number; likes?: number };
  return { views: Math.max(0, Number(row.views) || 0), likes: Math.max(0, Number(row.likes) || 0) };
}
// ---- High-traffic path: deltas go to the D1 job queue, the heartbeat sums them into one write per post ----
/** Queues a like/view delta; if the queue is unavailable it is written to D1 right away (never lost). */
async function queueStat(id: string, v: number, l: number, d: number) {
  const { sendJob } = await import("./queue.server");
  const ok = await sendJob({ kind: "poststat", bid: crypto.randomUUID(), id, views: v, likes: l, dislikes: d });
  if (!ok) await dynAdd(id, v, l, d).catch(() => addPending(id, v, l, d));
}
/** Worker side: applies a batch of queued deltas exactly once (done-marker per message in the same transaction). */
export async function applyStatJobs(jobs: StatJob[]) {
  if (!jobs.length) return;
  const now = Date.now();
  // Only jobs whose done-marker is new get applied: INSERT OR IGNORE + a check in the same transaction.
  const fresh: StatJob[] = [];
  const seen = await d1<{ bid: string }>(`SELECT bid FROM stat_jobs_done WHERE bid IN (${jobs.map((_, n) => `?${n + 1}`).join(",")})`, jobs.map((j) => j.bid));
  const done = new Set(seen.results.map((r) => r.bid));
  for (const j of jobs) if (!done.has(j.bid)) fresh.push(j);
  if (fresh.length) {
    await d1Batch([
      ...fresh.map((j) => ({ sql: "INSERT OR IGNORE INTO stat_jobs_done (bid, done_at) VALUES (?1, ?2)", params: [j.bid, now] })),
      ...[...coalesceStats(fresh)].map(([id, c]) => addStmt(id, c.views, c.likes, c.dislikes, now)),
    ]);
  }
  // Done-markers only need to outlive redelivery; trim week-old ones occasionally.
  if (Math.random() < 0.02) void d1("DELETE FROM stat_jobs_done WHERE done_at < ?1", [now - 7 * 86400_000]).catch(() => {});
  for (const j of jobs) memo.delete(j.id);
}

// When Redis fails once (down / over plan limit), use D1 only for 60s so one tap never mixes stores.
let redisDownUntil = 0;
async function live(cmds: (string | number)[][]): Promise<unknown[] | null> {
  if (Date.now() < redisDownUntil) return null;
  const r = await redisPipelineChecked(cmds);
  if (!r.ok) { redisDownUntil = Date.now() + 60_000; return null; }
  return r.out;
}

/** Counts one real view. Same viewer within 30 min = one view (Redis SET NX, or a D1 conditional upsert). */
export async function recordView(id: string, viewer: string, ip: string): Promise<{ counted: boolean }> {
  if (!allow(`v:${ip}`, 120)) return { counted: false };
  const r0 = await live([["SET", `pvw:${id}:${viewer}`, "1", "NX", "EX", VIEW_DEDUPE_S]]);
  if (r0) {
    if (r0[0] !== "OK") return { counted: false };
    await redis(["HINCRBY", H(id), "v", 1]);
    await queueStat(id, 1, 0, 0); // permanent total via the D1 job queue (direct write if the queue is down)
    memo.delete(id);
    void flushDurable().catch(() => {}); // retries leftovers only; never blocks the tap
    return { counted: true };
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    const r = await d1(
      `INSERT INTO post_views (post_id, viewer, expires_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(post_id, viewer) DO UPDATE SET expires_at = excluded.expires_at WHERE post_views.expires_at < ?4`,
      [id, viewer, now + VIEW_DEDUPE_S, now]);
    if (!r.meta.changes) return { counted: false }; // already counted in this window
    if (Math.random() < 0.01) void d1("DELETE FROM post_views WHERE expires_at < ?1", [now]).catch(() => {});
  } catch { return { counted: false }; } // D1 down
  try { await dynAdd(id, 1, 0, 0); } catch { return { counted: false }; }
  memo.delete(id);
  return { counted: true };
}

/** Sets this viewer's thumb. Atomic swap so double taps can't double count. */
export async function setVote(id: string, viewer: string, ip: string, vote: Vote): Promise<{ vote: Vote; likes: number } | null> {
  if (!allow(`l:${ip}`, 60)) return null;
  const key = `pvt:${id}:${viewer}`;
  const r0 = await live([vote === 0 ? ["GETDEL", key] : ["SET", key, String(vote), "GET"]]);
  if (r0) {
    const prev = (Number(r0[0]) || 0) as Vote;
    const d = voteDelta(prev, vote);
    const cmds: (string | number)[][] = [];
    if (d.likes) cmds.push(["HINCRBY", H(id), "l", d.likes]);
    if (d.dislikes) cmds.push(["HINCRBY", H(id), "d", d.dislikes]);
    const out = cmds.length ? await redisPipeline(cmds) : [];
    // Permanent record in D1: this viewer's thumb (the total follows via the queue).
    await saveVote(id, viewer, vote).catch(() => {});
    if (d.likes || d.dislikes) await queueStat(id, 0, d.likes, d.dislikes);
    memo.delete(id);
    void flushDurable().catch(() => {});
    const likes = d.likes ? Number(out[0]) : Number(await redis(["HGET", H(id), "l"]));
    return { vote, likes: Math.max(0, likes || 0) };
  }
  // Redis unavailable: keep the vote and the totals in D1 directly.
  const [old] = await d1Batch([
    { sql: "SELECT vote FROM post_votes WHERE post_id = ?1 AND viewer = ?2", params: [id, viewer] },
    voteStmt(id, viewer, vote),
  ]);
  const prev = (Number((old?.results[0] as { vote?: number } | undefined)?.vote) || 0) as Vote;
  const d = voteDelta(prev, vote);
  const s = await dynAdd(id, 0, d.likes, d.dislikes);
  memo.delete(id);
  return { vote, likes: s.likes };
}

const voteStmt = (id: string, viewer: string, vote: Vote): D1Stmt => vote === 0
  ? { sql: "DELETE FROM post_votes WHERE post_id = ?1 AND viewer = ?2", params: [id, viewer] }
  : { sql: "INSERT INTO post_votes (post_id, viewer, vote, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(post_id, viewer) DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at", params: [id, viewer, vote, Date.now()] };
async function saveVote(id: string, viewer: string, vote: Vote) { await d1Batch([voteStmt(id, viewer, vote)]); }

export async function getVote(id: string, viewer: string): Promise<Vote> {
  const r0 = await live([["GET", `pvt:${id}:${viewer}`]]);
  if (r0) return (Number(r0[0]) || 0) as Vote;
  try {
    const r = await d1<{ vote: number }>("SELECT vote FROM post_votes WHERE post_id = ?1 AND viewer = ?2", [id, viewer]);
    return (Number(r.results[0]?.vote) || 0) as Vote;
  } catch { return 0; }
}

// ---- Reads: per-isolate 10s memo, one pipelined Redis call, D1 fallback (and re-seed) ----
const memo = new Map<string, { v: PostStats; exp: number }>();
export async function readStats(ids: string[]): Promise<Record<string, PostStats>> {
  const out: Record<string, PostStats> = {};
  const need = ids.filter((id) => { const m = memo.get(id); if (m && m.exp > Date.now()) { out[id] = m.v; return false; } return true; });
  if (need.length) {
    const res = await redisPipeline(need.map((id) => ["HMGET", H(id), "v", "l"]));
    const missing: string[] = [];
    need.forEach((id, i) => {
      const r = res[i] as (string | null)[] | null;
      if (!r || (r[0] == null && r[1] == null)) missing.push(id);
      else out[id] = { views: Math.max(0, Number(r[0]) || 0), likes: Math.max(0, Number(r[1]) || 0) };
    });
    if (missing.length) {
      try {
        const sums = await readTotals(missing.slice(0, 100));
        const seed: (string | number)[][] = [];
        for (const [id, t] of sums) {
          if (!t.found) continue;
          const s = { views: Math.max(0, t.views), likes: Math.max(0, t.likes) };
          out[id] = s;
          seed.push(["HSETNX", H(id), "v", s.views], ["HSETNX", H(id), "l", s.likes], ["HSETNX", H(id), "d", Math.max(0, t.dislikes)]);
        }
        if (seed.length) void redisPipeline(seed);
      } catch { /* both down: show zeros */ }
      for (const id of missing) out[id] ??= { views: 0, likes: 0 };
    }
    for (const id of need) memo.set(id, { v: out[id]!, exp: Date.now() + 10_000 });
    if (memo.size > 5000) memo.clear();
  }
  return out;
}
