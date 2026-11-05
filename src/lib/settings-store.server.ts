// Site settings store: Redis first, Cloudflare D1 (site_settings, key 'SITE') as the permanent copy.
// Saves succeed if either store accepts the write; reads fall back Redis → D1 → null (defaults).
// A short per-isolate memo keeps visitor traffic off both stores.
import { pickSettingsRaw } from "./settings-pick";

const MEMO_MS = 15_000;
let memo: { raw: string | null; exp: number } | null = null;
async function fromD1(): Promise<string | null> {
  try {
    const { d1 } = await import("./backend.server");
    const r = await d1<{ data: string }>("SELECT data FROM site_settings WHERE key = 'SITE'");
    return r.results[0]?.data ?? null;
  } catch { return null; }
}

/** Raw JSON string of the saved settings, or null when nothing is saved / both stores are down. */
export async function readSettingsRaw(fresh = false): Promise<string | null> {
  if (!fresh && memo && memo.exp > Date.now()) return memo.raw;
  const { redis } = await import("./backend.server");
  const [r, d] = await Promise.all([
    redis(["GET", "site:settings"]).catch(() => null) as Promise<string | null>,
    fromD1(),
  ]);
  const raw = pickSettingsRaw(r, d);
  memo = { raw, exp: Date.now() + MEMO_MS };
  return raw;
}

/** Saves to both stores. ok = at least one accepted it (D1 is the durable one). */
export async function writeSettingsRaw(json: string): Promise<{ ok: boolean; redis: boolean; d1: boolean }> {
  const { redis, d1 } = await import("./backend.server");
  const stamped = JSON.stringify({ ...JSON.parse(json), _savedAt: Date.now() });
  const [rOk, dOk] = await Promise.all([
    redis(["SET", "site:settings", stamped]).then((x) => x === "OK").catch(() => false),
    d1("INSERT INTO site_settings (key, data, updated_at) VALUES ('SITE', ?1, ?2) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", [stamped, Date.now()])
      .then(() => true).catch(() => false),
  ]);
  if (rOk || dOk) memo = { raw: stamped, exp: Date.now() + MEMO_MS };
  return { ok: rOk || dOk, redis: rOk, d1: dOk };
}
