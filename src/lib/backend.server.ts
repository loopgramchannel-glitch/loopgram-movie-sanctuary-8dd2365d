// Server-only clients: Upstash Redis, Cloudflare D1, R2. Env read per call (Workers).
import { AwsClient } from "aws4fetch";

const env = (k: string) => process.env[k] ?? "";

// ---------- Redis (Upstash REST) ----------
// Circuit breaker (per isolate): after BREAK_AFTER consecutive failures, skip Redis for BREAK_MS so a
// down/over-quota Redis costs callers 0 ms instead of a 2.5 s timeout each. Callers already fail open.
const BREAK_AFTER = 3, BREAK_MS = 15_000;
let redisFails = 0, redisOpenUntil = 0;
export function redisCircuitOpen(now = Date.now()): boolean { return now < redisOpenUntil; }
export function redisRecord(ok: boolean, now = Date.now()): void {
  if (ok) { redisFails = 0; return; }
  if (++redisFails >= BREAK_AFTER) { redisOpenUntil = now + BREAK_MS; redisFails = 0; }
}
export function redisCircuitReset(): void { redisFails = 0; redisOpenUntil = 0; }

async function redisPost(path: string, body: unknown): Promise<Response | null> {
  const url = env("UPSTASH_REDIS_REST_URL"), token = env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token || redisCircuitOpen()) return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2500),
    });
    redisRecord(r.ok);
    return r.ok ? r : null;
  } catch { redisRecord(false); return null; }
}

export async function redis(cmd: (string | number)[]): Promise<unknown> {
  const r = await redisPost("", cmd);
  if (!r) return null;
  try { return ((await r.json()) as { result: unknown }).result; } catch { return null; }
}

/** Several commands in one HTTP round trip (Upstash /pipeline). Fails open with nulls. */
export async function redisPipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  if (!cmds.length) return [];
  const r = await redisPost("/pipeline", cmds);
  if (!r) return cmds.map(() => null);
  try { return ((await r.json()) as { result?: unknown }[]).map((x) => x?.result ?? null); }
  catch { return cmds.map(() => null); }
}

/** Like redisPipeline, but reports whether every command really ran (no transport error, no quota/command error). */
export async function redisPipelineChecked(cmds: (string | number)[][]): Promise<{ ok: boolean; out: unknown[] }> {
  const fail = { ok: false, out: cmds.map(() => null) };
  if (!cmds.length) return fail;
  const r = await redisPost("/pipeline", cmds);
  if (!r) return fail;
  try {
    const j = (await r.json()) as { result?: unknown; error?: string }[];
    return { ok: j.every((x) => x && !x.error), out: j.map((x) => x?.result ?? null) };
  } catch { return fail; }
}

/** Fixed-window rate limit in one round trip; fails open if Redis is down. */
// Local tally per isolate: Redis is synced every SYNC_EVERY requests (batched INCRBY) instead of on
// every request, removing a Redis round trip from most API calls. Global count stays accurate within SYNC_EVERY.
const SYNC_EVERY = 10;
const rl = new Map<string, { pending: number; known: number }>();
export async function rateLimit(ip: string, limit = 120, windowSec = 60): Promise<boolean> {
  const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  let e = rl.get(key);
  if (!e) {
    if (rl.size > 5000) rl.clear();
    e = { pending: 0, known: 0 };
    rl.set(key, e);
  }
  e.pending++;
  if (e.known + e.pending > limit) return false;
  // Near the limit, sync every request so cross-instance overshoot shrinks to in-flight requests only.
  const nearLimit = e.known + e.pending > limit - SYNC_EVERY;
  if (!nearLimit && e.pending < SYNC_EVERY && e.known + e.pending > 1) return true;
  const inc = e.pending;
  e.pending = 0;
  const [n] = await redisPipeline([["INCRBY", key, inc], ["EXPIRE", key, windowSec, "NX"]]);
  if (typeof n === "number") e.known = n;
  else e.known += inc;
  return typeof n !== "number" || n <= limit;
}

/** In-memory sliding-window limiter (per isolate). No network calls, so reads never depend on Redis. */
const sw = new Map<string, number[]>();
export function localRateLimit(key: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  if (sw.size > 10_000) sw.clear();
  const hits = (sw.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) { sw.set(key, hits); return false; }
  hits.push(now);
  sw.set(key, hits);
  return true;
}

// ---------- Cloudflare D1 (permanent database, HTTP API) ----------
export type D1Stmt = { sql: string; params?: (string | number | null)[] };
export type D1Result<T = Record<string, unknown>> = { results: T[]; meta: { changes?: number; rows_read?: number } };
export function d1Configured(): boolean {
  return !!(env("CLOUDFLARE_ACCOUNT_ID") && env("CLOUDFLARE_D1_DATABASE_ID") && env("CLOUDFLARE_D1_TOKEN"));
}
/** Runs statements in one round trip. Several statements run as one transaction (all or nothing). */
export async function d1Batch(stmts: D1Stmt[]): Promise<D1Result[]> {
  if (!d1Configured()) throw new Error("D1 not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_D1_TOKEN)");
  const url = `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${env("CLOUDFLARE_D1_DATABASE_ID")}/query`;
  const body = stmts.length === 1 ? { sql: stmts[0]!.sql, params: stmts[0]!.params ?? [] } : { batch: stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] })) };
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST", signal: AbortSignal.timeout(6000),
        headers: { Authorization: `Bearer ${env("CLOUDFLARE_D1_TOKEN")}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (r.ok) {
        const j = JSON.parse(t) as { success: boolean; result: D1Result[]; errors?: { message: string }[] };
        if (j.success) return j.result;
        throw new Error(`D1 error: ${j.errors?.[0]?.message ?? "unknown"}`);
      }
      last = `D1 ${r.status}: ${t.slice(0, 300)}`;
      if (r.status < 500 && r.status !== 429) break; // permanent (bad SQL, constraint, permission)
    } catch (e) { last = String(e); if (/D1 error/.test(last)) break; }
    await new Promise((res) => setTimeout(res, 150 * 2 ** attempt));
  }
  throw new Error(last);
}
export async function d1<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): Promise<D1Result<T>> {
  return (await d1Batch([{ sql, params }]))[0] as D1Result<T>;
}
/** Per-isolate throttle for side jobs triggered by views : true at most once per window per key. */
const sideJobAt = new Map<string, number>();
export function onceEvery(key: string, ms: number): boolean {
  const now = Date.now();
  if (now - (sideJobAt.get(key) ?? 0) < ms) return false;
  if (sideJobAt.size > 5000) sideJobAt.clear();
  sideJobAt.set(key, now);
  return true;
}

// ---------- R2 ----------
function r2() {
  return new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    region: "auto", service: "s3",
  });
}
/** Checks an owner file in R2: does it exist, and what do its first bytes say it is. */
export async function r2Probe(key: string): Promise<{ exists: boolean; head: Uint8Array | null }> {
  const url = `${env("R2_ENDPOINT").replace(/\/$/, "")}/${env("R2_BUCKET_NAME")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const r = await r2().fetch(url, { headers: { Range: "bytes=0-63" }, signal: AbortSignal.timeout(5000) });
  if (r.status === 404) return { exists: false, head: null };
  if (!r.ok && r.status !== 206) throw new Error(`R2 probe ${r.status}`);
  return { exists: true, head: new Uint8Array(await r.arrayBuffer()) };
}

export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
}
