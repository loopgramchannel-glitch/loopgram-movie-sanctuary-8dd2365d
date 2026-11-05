// Removes secrets from log context before anything leaves the server.
const SECRET_KEY = /(authorization|token|secret|password|api[-_]?key|cookie|signature|x-amz-[a-z-]+)/i;
const SECRET_VAL = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /X-Amz-(Signature|Credential|Security-Token)=[^&\s"]+/gi, // signed URLs
  /\b(sk|cfut|cfat|whsec)_[A-Za-z0-9]{8,}/g,
];
export function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (typeof v === "string") { let s = v.slice(0, 500); for (const r of SECRET_VAL) s = s.replace(r, "[redacted]"); return s; }
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v).slice(0, 40)) o[k] = SECRET_KEY.test(k) ? "[redacted]" : scrub(x, depth + 1);
    return o;
  }
  return v;
}
