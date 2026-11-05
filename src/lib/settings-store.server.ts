// Site settings store: Redis first, DynamoDB (PK SETTINGS#SITE / SK DATA) as the permanent copy.
// Saves succeed if either store accepts the write; reads fall back Redis → DynamoDB → null (defaults).
// A short per-isolate memo keeps visitor traffic off both stores.
import { pickSettingsRaw } from "./settings-pick";

const MEMO_MS = 15_000;
let memo: { raw: string | null; exp: number } | null = null;
const KEY = { PK: { S: "SETTINGS#SITE" }, SK: { S: "DATA" } };

async function fromDynamo(): Promise<string | null> {
  try {
    const { dynamo } = await import("./backend.server");
    const r = await dynamo("GetItem", { TableName: process.env["DYNAMODB_TABLE_NAME"], Key: KEY, ConsistentRead: true });
    return (r?.Item?.data?.S as string | undefined) ?? null;
  } catch { return null; }
}

/** Raw JSON string of the saved settings, or null when nothing is saved / both stores are down. */
export async function readSettingsRaw(fresh = false): Promise<string | null> {
  if (!fresh && memo && memo.exp > Date.now()) return memo.raw;
  const { redis } = await import("./backend.server");
  const [r, d] = await Promise.all([
    redis(["GET", "site:settings"]).catch(() => null) as Promise<string | null>,
    fromDynamo(),
  ]);
  const raw = pickSettingsRaw(r, d);
  memo = { raw, exp: Date.now() + MEMO_MS };
  return raw;
}

/** Saves to both stores. ok = at least one accepted it (DynamoDB is the durable one). */
export async function writeSettingsRaw(json: string): Promise<{ ok: boolean; redis: boolean; dynamo: boolean }> {
  const { redis, dynamo } = await import("./backend.server");
  const stamped = JSON.stringify({ ...JSON.parse(json), _savedAt: Date.now() });
  const [rOk, dOk] = await Promise.all([
    redis(["SET", "site:settings", stamped]).then((x) => x === "OK").catch(() => false),
    dynamo("PutItem", { TableName: process.env["DYNAMODB_TABLE_NAME"], Item: { ...KEY, data: { S: stamped }, updatedAt: { N: String(Date.now()) } } })
      .then(() => true).catch(() => false),
  ]);
  if (rOk || dOk) memo = { raw: stamped, exp: Date.now() + MEMO_MS };
  return { ok: rOk || dOk, redis: rOk, dynamo: dOk };
}
