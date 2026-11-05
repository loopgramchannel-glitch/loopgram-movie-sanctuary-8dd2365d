// Pure: choose between the Redis and DynamoDB copies of site settings. Newest save (_savedAt) wins,
// so a stale Redis copy left over from before a quota outage never overrides a newer DynamoDB save.
function savedAt(raw: string | null): number {
  if (!raw) return -1;
  try { const v = JSON.parse(raw); return typeof v?._savedAt === "number" ? v._savedAt : 0; } catch { return -1; }
}

export function pickSettingsRaw(redisRaw: string | null, dynamoRaw: string | null): string | null {
  const r = savedAt(redisRaw), d = savedAt(dynamoRaw);
  if (r < 0 && d < 0) return null;
  return d > r ? dynamoRaw : redisRaw ?? dynamoRaw;
}
