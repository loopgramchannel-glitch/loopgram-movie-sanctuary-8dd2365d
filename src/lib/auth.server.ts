// Server-only Firebase verification + Identity Toolkit admin calls (workerd-safe: fetch + jose, no firebase-admin).
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { roleFromVerified, type Role } from "./auth";

const env = (k: string) => process.env[k] ?? "";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

export class AuthError extends Error {
  constructor(public status: 401 | 403, msg: string) { super(msg); }
}

export type Verified = { uid: string; email?: string | undefined; role: Role; authTime: number };

/** Verifies a Firebase ID token's signature, issuer, audience and expiry. Throws AuthError(401). */
export async function verifyIdToken(token: unknown): Promise<Verified> {
  const pid = env("FIREBASE_PROJECT_ID");
  if (!pid) throw new AuthError(401, "Auth not configured");
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) throw new AuthError(401, "Not signed in");
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${pid}`, audience: pid, algorithms: ["RS256"] });
    const uid = String(payload.sub ?? "");
    if (!uid) throw new Error("no sub");
    return { uid, email: payload["email"] as string | undefined, role: roleFromVerified(uid, payload as Record<string, unknown>, env("OWNER_UID") || undefined), authTime: Number(payload["auth_time"] ?? 0) };
  } catch {
    throw new AuthError(401, "Session expired. Sign in again.");
  }
}

// ---- Google OAuth access token for the service account (cached per isolate) ----
let cached: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const email = env("FIREBASE_CLIENT_EMAIL"), pem = env("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!email || !pem) throw new Error("Firebase service account not configured");
  const key = await importPKCS8(pem, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(email).setSubject(email)
    .setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("1h").sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!r.ok || !j.access_token) throw new Error(`Google token ${r.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Identity Toolkit admin call (project-scoped). */
export async function idt<T = any>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env("FIREBASE_PROJECT_ID")}/${path}`, {
    method, signal: AbortSignal.timeout(6000),
    headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Identity Toolkit ${path} ${r.status}: ${t.slice(0, 200)}`);
  return (t ? JSON.parse(t) : {}) as T;
}

export type FbUser = { localId: string; email?: string; displayName?: string; disabled?: boolean; createdAt?: string; lastLoginAt?: string; validSince?: string; customAttributes?: string };

export async function lookupUser(uid: string): Promise<FbUser | null> {
  const r = await idt<{ users?: FbUser[] }>("accounts:lookup", { localId: [uid] });
  return r.users?.[0] ?? null;
}

/** Full owner check for every Studio operation: valid token + owner role + account live + session not revoked. */
export async function requireOwner(token: unknown): Promise<Verified> {
  const v = await verifyIdToken(token);
  if (v.role !== "owner") {
    void audit({ uid: v.uid, email: v.email }, "studio.denied", "studio", "denied");
    throw new AuthError(403, "Not allowed");
  }
  const u = await lookupUser(v.uid);
  if (!u || u.disabled) throw new AuthError(401, "Account unavailable");
  if (u.validSince && Number(u.validSince) > v.authTime) throw new AuthError(401, "Session revoked. Sign in again.");
  return v;
}

// ---- Audit log (Redis list, capped; written only here on the server) ----
export async function audit(actor: { uid: string; email?: string | undefined }, action: string, target: string, outcome: "ok" | "failed" | "denied", context: Record<string, unknown> = {}) {
  const { redis } = await import("./backend.server");
  const { log } = await import("./log.server");
  const entry = { at: new Date().toISOString(), uid: actor.uid, email: actor.email ?? null, action, target, outcome, context };
  log(outcome === "ok" ? "info" : "warn", "studio.audit", entry);
  await redis(["LPUSH", "studio:audit", JSON.stringify(entry)]);
  await redis(["LTRIM", "studio:audit", 0, 4999]);
}
