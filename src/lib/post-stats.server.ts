// Post views & likes engine. Redis (Upstash) is the live counter; DynamoDB keeps the permanent total.
// Hot paths are batched per isolate so a viral video costs ~1 storage write per few seconds, not 1 per tap.
import { dynamo, redis, redisPipeline, redisPipelineChecked } from "./backend.server";
import { VIEW_DEDUPE_S, voteDelta, type PostStats, type Vote } from "./post-stats";
import { coalesceStats, type StatJob } from "./jobs";

const env = (k: string) => process.env[k] ?? "";
const H = (id: string) => `ps:${id}`; // hash: v (views), l (likes), d (dislikes)
const FLUSH_MS = 5_000;

// ---- Durable batching to DynamoDB (PK POSTSTAT#<id>, SK STATS) ----
const pending = new Map<string, { v: number; l: number; d: number }>();
let lastFlush = 0;
async function flushDurable(force = false) {
  const now = Date.now();
  if (!pending.size || (!force && now - lastFlush < FLUSH_MS)) return;
  lastFlush = now;
  const batch = [...pending]; pending.clear();
  await Promise.all(batch.map(async ([id, c]) => {
    try {
      await dynamo("UpdateItem", {
        TableName: env("DYNAMODB_TABLE_NAME"),
        Key: { PK: { S: `POSTSTAT#${id}` }, SK: { S: shardSk(Math.floor(Math.random() * SHARDS)) } },
        UpdateExpression: "ADD #v :v, #l :l, #d :d SET #u = :u",
        ExpressionAttributeNames: { "#v": "views", "#l": "likes", "#d": "dislikes", "#u": "updated_at" },
        ExpressionAttributeValues: { ":v": { N: String(c.v) }, ":l": { N: String(c.l) }, ":d": { N: String(c.d) }, ":u": { N: String(now) } },
      });
    } catch {
      const p = pending.get(id) ?? { v: 0, l: 0, d: 0 }; // keep for the next flush
      pending.set(id, { v: p.v + c.v, l: p.l + c.l, d: p.d + c.d });
    }
  }));
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

// ---- DynamoDB direct path: used when Redis is down or over its plan limit ----
// Counter sharding (YouTube-style): direct writes spread over SHARDS rows (SK STATS, STATS#1..n-1)
// so a viral post never hammers one row; reads sum every shard.
export const SHARDS = 10;
export const shardSk = (n: number) => (n === 0 ? "STATS" : `STATS#${n}`);
const T = () => env("DYNAMODB_TABLE_NAME");
const statKey = (id: string, shard = 0) => ({ PK: { S: `POSTSTAT#${id}` }, SK: { S: shardSk(shard) } });
/** Sums all shard rows for each id (BatchGetItem, 100 keys per call). */
async function sumShards(ids: string[]): Promise<Map<string, { views: number; likes: number; dislikes: number; found: boolean }>> {
  const out = new Map<string, { views: number; likes: number; dislikes: number; found: boolean }>();
  for (const id of ids) out.set(id, { views: 0, likes: 0, dislikes: 0, found: false });
  const keys = ids.flatMap((id) => Array.from({ length: SHARDS }, (_, n) => statKey(id, n)));
  for (let i = 0; i < keys.length; i += 100) {
    const r = await dynamo("BatchGetItem", { RequestItems: { [T()]: { Keys: keys.slice(i, i + 100) } } });
    for (const it of (r.Responses?.[T()] ?? []) as any[]) {
      const s = out.get(String(it.PK.S).slice(9)); if (!s) continue;
      s.found = true;
      s.views += Number(it.views?.N) || 0; s.likes += Number(it.likes?.N) || 0; s.dislikes += Number(it.dislikes?.N) || 0;
    }
  }
  return out;
}
async function dynAdd(id: string, v: number, l: number, d: number) {
  await dynamo("UpdateItem", {
    TableName: T(), Key: statKey(id, Math.floor(Math.random() * SHARDS)),
    UpdateExpression: "ADD #v :v, #l :l, #d :d SET #u = :u",
    ExpressionAttributeNames: { "#v": "views", "#l": "likes", "#d": "dislikes", "#u": "updated_at" },
    ExpressionAttributeValues: { ":v": { N: String(v) }, ":l": { N: String(l) }, ":d": { N: String(d) }, ":u": { N: String(Date.now()) } },
  });
  const s = (await sumShards([id])).get(id)!;
  return { views: Math.max(0, s.views), likes: Math.max(0, s.likes) };
}
// ---- High-traffic path: deltas go to the SQS queue, the worker sums them into one write per post ----
/** Queues a like/view delta; if the queue is unavailable it is written to DynamoDB right away (never lost). */
async function queueStat(id: string, v: number, l: number, d: number) {
  const { sendJob } = await import("./sqs.server");
  const ok = await sendJob({ kind: "poststat", bid: crypto.randomUUID(), id, views: v, likes: l, dislikes: d });
  if (!ok) await dynAdd(id, v, l, d).catch(() => addPending(id, v, l, d));
}
const MARK_TTL_S = 7 * 86400;
function statTx(jobs: StatJob[]) {
  const now = Date.now(); const exp = String(Math.floor(now / 1000) + MARK_TTL_S);
  const marks = jobs.map((j) => ({ Put: {
    TableName: T(), Item: { PK: { S: `STATJOB#${j.bid}` }, SK: { S: "DONE" }, exp: { N: exp } },
    ConditionExpression: "attribute_not_exists(PK)",
  } }));
  const adds = [...coalesceStats(jobs)].map(([id, c]) => ({ Update: {
    TableName: T(), Key: statKey(id),
    UpdateExpression: "ADD #v :v, #l :l, #d :d SET #u = :u",
    ExpressionAttributeNames: { "#v": "views", "#l": "likes", "#d": "dislikes", "#u": "updated_at" },
    ExpressionAttributeValues: { ":v": { N: String(c.views) }, ":l": { N: String(c.likes) }, ":d": { N: String(c.dislikes) }, ":u": { N: String(now) } },
  } }));
  return dynamo("TransactWriteItems", { TransactItems: [...marks, ...adds] });
}
/** Worker side: applies a batch of queued deltas exactly once (a done-marker per message, same transaction). */
export async function applyStatJobs(jobs: StatJob[]) {
  try { await statTx(jobs); }
  catch (e) {
    if (!/TransactionCanceled/.test(String(e))) throw e;
    // A message in the batch was already applied (redelivery): apply the rest one by one.
    for (const j of jobs) {
      try { await statTx([j]); } catch (e2) { if (!/TransactionCanceled/.test(String(e2))) throw e2; }
    }
  }
  for (const j of jobs) memo.delete(j.id);
}

// When Redis fails once (down / over plan limit), use DynamoDB only for 60s so one tap never mixes stores.
let redisDownUntil = 0;
async function live(cmds: (string | number)[][]): Promise<unknown[] | null> {
  if (Date.now() < redisDownUntil) return null;
  const r = await redisPipelineChecked(cmds);
  if (!r.ok) { redisDownUntil = Date.now() + 60_000; return null; }
  return r.out;
}

/** Counts one real view. Same viewer within 30 min = one view (Redis SET NX, or a DynamoDB conditional put). */
export async function recordView(id: string, viewer: string, ip: string): Promise<{ counted: boolean }> {
  if (!allow(`v:${ip}`, 120)) return { counted: false };
  const r0 = await live([["SET", `pvw:${id}:${viewer}`, "1", "NX", "EX", VIEW_DEDUPE_S]]);
  if (r0) {
    if (r0[0] !== "OK") return { counted: false };
    await redis(["HINCRBY", H(id), "v", 1]);
    await queueStat(id, 1, 0, 0); // permanent total via the SQS queue (direct write if the queue is down)
    memo.delete(id);
    void flushDurable().catch(() => {}); // retries leftovers only; never blocks the tap
    return { counted: true };
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    await dynamo("PutItem", {
      TableName: T(), Item: { PK: { S: `POSTVIEW#${id}` }, SK: { S: viewer }, exp: { N: String(now + VIEW_DEDUPE_S) } },
      ConditionExpression: "attribute_not_exists(PK) OR #e < :n",
      ExpressionAttributeNames: { "#e": "exp" }, ExpressionAttributeValues: { ":n": { N: String(now) } },
    });
  } catch { return { counted: false }; } // condition failed (already counted) or DynamoDB down
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
    // Permanent record in DynamoDB: this viewer's thumb + the total, written immediately.
    const vk = { PK: { S: `POSTVOTE#${id}` }, SK: { S: viewer } };
    await (vote === 0 ? dynamo("DeleteItem", { TableName: T(), Key: vk }) : dynamo("PutItem", { TableName: T(), Item: { ...vk, vote: { N: String(vote) } } })).catch(() => {});
    if (d.likes || d.dislikes) await queueStat(id, 0, d.likes, d.dislikes);
    memo.delete(id);
    void flushDurable().catch(() => {});
    const likes = d.likes ? Number(out[0]) : Number(await redis(["HGET", H(id), "l"]));
    return { vote, likes: Math.max(0, likes || 0) };
  }
  // Redis unavailable: keep the vote and the totals in DynamoDB directly.
  const vk = { PK: { S: `POSTVOTE#${id}` }, SK: { S: viewer } };
  const r = vote === 0
    ? await dynamo("DeleteItem", { TableName: T(), Key: vk, ReturnValues: "ALL_OLD" })
    : await dynamo("PutItem", { TableName: T(), Item: { ...vk, vote: { N: String(vote) } }, ReturnValues: "ALL_OLD" });
  const prev = (Number(r.Attributes?.vote?.N) || 0) as Vote;
  const d = voteDelta(prev, vote);
  const s = await dynAdd(id, 0, d.likes, d.dislikes);
  memo.delete(id);
  return { vote, likes: s.likes };
}

export async function getVote(id: string, viewer: string): Promise<Vote> {
  const r0 = await live([["GET", `pvt:${id}:${viewer}`]]);
  if (r0) return (Number(r0[0]) || 0) as Vote;
  try {
    const r = await dynamo("GetItem", { TableName: T(), Key: { PK: { S: `POSTVOTE#${id}` }, SK: { S: viewer } } });
    return (Number(r.Item?.vote?.N) || 0) as Vote;
  } catch { return 0; }
}

// ---- Reads: per-isolate 10s memo, one pipelined Redis call, DynamoDB fallback (and re-seed) ----
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
        const sums = await sumShards(missing.slice(0, 100));
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
