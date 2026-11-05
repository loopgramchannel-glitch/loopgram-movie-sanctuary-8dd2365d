// Server functions for login + Studio. Every Studio function re-verifies the caller with requireOwner().
// Server-only modules are imported inside handlers so nothing secret reaches the browser bundle.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tok = z.object({ token: z.string().min(20).max(4096) });

export const SiteSettings = z.object({
  banner: z.string().trim().max(200).default(""),
  bannerOn: z.boolean().default(false),
  maintenance: z.boolean().default(false),
  autoQueue: z.boolean().default(true),
  // Ads (Studio → Ads). Ads never show to the owner.
  adsOn: z.boolean().default(true),
  adWatchOn: z.boolean().default(true),
  adFeedOn: z.boolean().default(true),
  adUnitsOff: z.array(z.enum(["watch", "feed", "detail", "search", "home", "shorts"])).max(6).default([]),
  adFeedEvery: z.number().int().min(3).max(30).default(8),
});
export type SiteSettingsT = z.infer<typeof SiteSettings>;

async function readSettings(fresh = false): Promise<SiteSettingsT> {
  const { readSettingsRaw } = await import("./settings-store.server");
  const raw = await readSettingsRaw(fresh);
  try { return SiteSettings.parse(raw ? JSON.parse(raw) : {}); } catch { return SiteSettings.parse({}); }
}

async function owner(token: string) {
  const { requireOwner, AuthError } = await import("./auth.server");
  try { return await requireOwner(token); }
  catch (e) { if (e instanceof AuthError) throw new Error(`${e.status}: ${e.message}`); throw new Error("401: Could not verify session"); }
}

/** Public: Firebase WEB config (public by Google's design) + public site settings. No secrets. */
export const getPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  const e = (k: string) => process.env[k] ?? "";
  return {
    firebase: { apiKey: e("GOOGLE_API_KEY").trim(), authDomain: e("FIREBASE_AUTH_DOMAIN"), projectId: e("FIREBASE_PROJECT_ID"), appId: e("FIREBASE_APP_ID"), messagingSenderId: e("FIREBASE_MESSAGING_SENDER_ID"), storageBucket: e("FIREBASE_STORAGE_BUCKET") },
    settings: await readSettings(),
  };
});

/** Verified role of the signed-in caller (the only role source the UI trusts). */
export const whoami = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  const { verifyIdToken, AuthError } = await import("./auth.server");
  try { const v = await verifyIdToken(data.token); return { ok: true as const, role: v.role, email: v.email ?? null }; }
  catch (e) { return { ok: false as const, status: e instanceof AuthError ? e.status : 401 }; }
});

type Check = { name: string; status: "ok" | "down" | "not_configured"; ms?: number; note?: string };
async function timed(name: string, needed: string[], fn: () => Promise<unknown>): Promise<Check> {
  if (needed.some((k) => !process.env[k])) return { name, status: "not_configured" };
  const t = Date.now();
  try { await fn(); return { name, status: "ok", ms: Date.now() - t }; }
  catch (e) { return { name, status: "down", ms: Date.now() - t, note: String(e).replace(/[A-Za-z0-9_-]{24,}/g, "…").slice(0, 120) }; }
}

export const studioHealth = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  const b = await import("./backend.server");
  const checks = await Promise.all([
    timed("Firebase Authentication", ["FIREBASE_PROJECT_ID", "FIREBASE_PRIVATE_KEY"], async () => { const { idt } = await import("./auth.server"); await idt("accounts:query", { returnUserInfo: false, limit: "1" }); }),
    timed("Upstash Redis", ["UPSTASH_REDIS_REST_URL"], async () => { if ((await b.redis(["PING"])) !== "PONG") throw new Error("no PONG"); }),
    timed("DynamoDB", ["DYNAMODB_TABLE_NAME", "AWS_SECRET_ACCESS_KEY"], () => b.dynamo("DescribeTable", { TableName: process.env["DYNAMODB_TABLE_NAME"] })),
    timed("Amazon SQS", ["SQS_QUEUE_URL"], async () => { const { queueStats } = await import("./sqs.server"); await queueStats(); }),
    timed("Cloudflare R2", ["R2_ENDPOINT", "R2_SECRET_ACCESS_KEY"], () => listR2("", 1)),
    timed("Algolia", ["ALGOLIA_APP_ID", "ALGOLIA_ADMIN_API_KEY"], async () => {
      const r = await fetch(`https://${process.env["ALGOLIA_APP_ID"]}-dsn.algolia.net/1/indexes?page=0&hitsPerPage=1`, { headers: { "X-Algolia-Application-Id": process.env["ALGOLIA_APP_ID"]!, "X-Algolia-API-Key": process.env["ALGOLIA_ADMIN_API_KEY"]! }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`status ${r.status}`);
    }),
    timed("Turnstile", ["TURNSTILE_SECRET_KEY"], async () => {}),
  ]);
  checks[checks.length - 1]!.note = "Secret is set; verified only when a form sends a token.";
  return { checks, at: new Date().toISOString() };
});

export const studioOverview = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  const { idt } = await import("./auth.server");
  const { redis } = await import("./backend.server");
  const [accounts, queue, audit] = await Promise.all([
    idt<{ recordsCount?: string }>("accounts:query", { returnUserInfo: false }).then((r) => Number(r.recordsCount ?? 0)).catch(() => null),
    import("./sqs.server").then((m) => m.queueStats()).catch(() => null),
    redis(["LRANGE", "studio:audit", 0, 9]).then((r) => ((r as string[] | null) ?? []).map((x) => JSON.parse(x))).catch(() => []),
  ]);
  return { accounts, queue, audit, settings: await readSettings() };
});

export const studioUsers = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.extend({ pageToken: z.string().max(500).optional(), email: z.string().max(200).optional() }).parse(d)).handler(async ({ data }) => {
  const me = await owner(data.token);
  const { idt, audit } = await import("./auth.server");
  const ownerUid = process.env["OWNER_UID"];
  let users: any[] = [], next: string | null = null;
  if (data.email?.trim()) {
    const r = await idt<{ users?: any[] }>("accounts:lookup", { email: [data.email.trim().toLowerCase()] }).catch(() => ({ users: [] }));
    users = r.users ?? [];
  } else {
    const q = new URLSearchParams({ maxResults: "25" }); if (data.pageToken) q.set("nextPageToken", data.pageToken);
    const r = await idt<{ users?: any[]; nextPageToken?: string }>(`accounts:batchGet?${q}`, undefined, "GET");
    users = r.users ?? []; next = r.nextPageToken ?? null;
  }
  void audit(me, "users.view", data.email ? "lookup" : "list", "ok", { count: users.length });
  return {
    next,
    users: users.map((u) => {
      let role = "user"; try { if (u.localId === ownerUid || JSON.parse(u.customAttributes ?? "{}").role === "owner") role = "owner"; } catch {}
      return { uid: u.localId as string, email: (u.email ?? null) as string | null, name: (u.displayName ?? null) as string | null, disabled: !!u.disabled, createdAt: u.createdAt ? new Date(Number(u.createdAt)).toISOString() : null, lastLoginAt: u.lastLoginAt ? new Date(Number(u.lastLoginAt)).toISOString() : null, role };
    }),
  };
});

export const studioUserAction = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.extend({ uid: z.string().min(1).max(128), action: z.enum(["disable", "enable", "revoke"]) }).parse(d)).handler(async ({ data }) => {
  const me = await owner(data.token);
  const { idt, audit } = await import("./auth.server");
  if (data.action !== "revoke" && (data.uid === me.uid || data.uid === process.env["OWNER_UID"])) {
    void audit(me, `user.${data.action}`, data.uid, "denied", { reason: "owner account protected" });
    throw new Error("403: The owner account can't be disabled here.");
  }
  const body = data.action === "revoke" ? { localId: data.uid, validSince: String(Math.floor(Date.now() / 1000)) } : { localId: data.uid, disableUser: data.action === "disable" };
  try { await idt("accounts:update", body); await audit(me, `user.${data.action}`, data.uid, "ok"); return { ok: true }; }
  catch (e) { await audit(me, `user.${data.action}`, data.uid, "failed"); throw new Error("502: Firebase rejected the change. Try again."); }
});

/** Owner logout: revokes refresh tokens so the old session can't reach Studio again. */
export const studioLogout = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  const { verifyIdToken, idt, audit } = await import("./auth.server");
  const v = await verifyIdToken(data.token).catch(() => null);
  if (!v || v.role !== "owner") return { ok: true };
  await idt("accounts:update", { localId: v.uid, validSince: String(Math.floor(Date.now() / 1000)) }).catch(() => {});
  await audit(v, "studio.logout", "session", "ok");
  return { ok: true };
});

export const studioSaveSettings = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.extend({ settings: SiteSettings }).parse(d)).handler(async ({ data }) => {
  const me = await owner(data.token);
  const { writeSettingsRaw } = await import("./settings-store.server");
  const { audit } = await import("./auth.server");
  const before = await readSettings(true);
  const { ok } = await writeSettingsRaw(JSON.stringify(data.settings));
  await audit(me, "settings.update", "site", ok ? "ok" : "failed", { before, after: data.settings }).catch(() => {});
  if (!ok) throw new Error("502: Could not save settings (storage unavailable).");
  return { ok: true };
});

export const studioAudit = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.extend({ page: z.number().int().min(0).max(200).default(0) }).parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  const { redis } = await import("./backend.server");
  const r = (await redis(["LRANGE", "studio:audit", data.page * 50, data.page * 50 + 49])) as string[] | null;
  return { entries: (r ?? []).map((x) => JSON.parse(x)), page: data.page };
});

export const studioSearch = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.extend({ kind: z.enum(["reconcile", "retry"]) }).parse(d)).handler(async ({ data }) => {
  const me = await owner(data.token);
  const { handleSearchJob, retryFailed } = await import("./algolia.server");
  const { audit } = await import("./auth.server");
  try {
    const result = data.kind === "retry" ? await retryFailed() : await handleSearchJob({ kind: "reconcile" });
    await audit(me, `search.${data.kind}`, "algolia", "ok");
    return { ok: true, result: JSON.parse(JSON.stringify(result ?? null)) };
  } catch (e) { await audit(me, `search.${data.kind}`, "algolia", "failed"); throw new Error("502: Search update failed; safe to retry."); }
});

export const studioJobs = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.extend({ process: z.boolean().default(false) }).parse(d)).handler(async ({ data }) => {
  const me = await owner(data.token);
  const sqs = await import("./sqs.server");
  const { audit } = await import("./auth.server");
  let processed: unknown = null;
  if (data.process) {
    const { handleSearchJob } = await import("./algolia.server");
    try { processed = await sqs.processBatch(handleSearchJob, 10); await audit(me, "jobs.process", "sqs", "ok"); }
    catch (e) { await audit(me, "jobs.process", "sqs", "failed"); throw new Error("502: Queue unavailable (check AWS permissions)."); }
  }
  const stats = await sqs.queueStats().catch(() => null);
  return { stats, processed: JSON.parse(JSON.stringify(processed)) };
});

async function listR2(cursor: string, max = 50) {
  const { AwsClient } = await import("aws4fetch");
  const c = new AwsClient({ accessKeyId: process.env["R2_ACCESS_KEY_ID"]!, secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"]!, service: "s3", region: "auto" });
  const q = new URLSearchParams({ "list-type": "2", "max-keys": String(max) }); if (cursor) q.set("continuation-token", cursor);
  const r = await c.fetch(`${process.env["R2_ENDPOINT"]!.replace(/\/$/, "")}/${process.env["R2_BUCKET_NAME"]}?${q}`, { signal: AbortSignal.timeout(6000) });
  const xml = await r.text();
  if (!r.ok) throw new Error(`R2 ${r.status}`);
  const tag = (s: string, t: string) => s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? "";
  const items = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({ key: tag(m[1]!, "Key"), size: Number(tag(m[1]!, "Size")), modified: tag(m[1]!, "LastModified") }));
  return { items, next: tag(xml, "NextContinuationToken") || null };
}

export const studioMedia = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.extend({ cursor: z.string().max(1000).default("") }).parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  try { const r = await listR2(data.cursor); return { ...r, publicUrl: process.env["R2_PUBLIC_URL"] ?? null }; }
  catch { throw new Error("502: Could not list R2 files."); }
});

/** Owner-only audience snapshot from Firebase sign-ins. */
export const studioMoney = createServerFn({ method: "POST" }).inputValidator((d: unknown) => tok.parse(d)).handler(async ({ data }) => {
  await owner(data.token);
  const users = await (async () => {
    const { idt } = await import("./auth.server");
    const r = await idt<{ users?: any[] }>("accounts:batchGet?maxResults=1000", undefined, "GET");
    const now = Date.now(); const list = r.users ?? [];
    const within = (d: number) => list.filter((u) => Number(u.lastLoginAt ?? 0) > now - d * 864e5).length;
    return { total: list.length, day: within(1), week: within(7), month: within(30) };
  })().catch(() => null);
  return { users };
});
