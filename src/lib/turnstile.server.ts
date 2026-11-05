// Server-side Turnstile verification. Fails closed: missing, invalid, expired, replayed or
// unverifiable tokens are all rejected. Siteverify itself rejects reused tokens (timeout-or-duplicate).
export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export async function verifyTurnstile(token: unknown, ip?: string, opts: { secret?: string; expectedAction?: string } = {}): Promise<TurnstileResult> {
  const secret = opts.secret ?? process.env["TURNSTILE_SECRET_KEY"];
  if (!secret) return { ok: false, reason: "not-configured" };
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return { ok: false, reason: "missing-token" };
  const form = new URLSearchParams({ secret, response: token, idempotency_key: crypto.randomUUID() });
  if (ip) form.set("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, reason: "provider-error" };
    const j = (await r.json()) as { success: boolean; action?: string; "error-codes"?: string[] };
    if (!j.success) return { ok: false, reason: j["error-codes"]?.[0] ?? "rejected" };
    if (opts.expectedAction && j.action !== opts.expectedAction) return { ok: false, reason: "wrong-action" };
    return { ok: true };
  } catch { return { ok: false, reason: "provider-unreachable" }; }
}
