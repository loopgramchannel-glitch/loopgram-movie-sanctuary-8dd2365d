// Pure, browser-safe auth helpers (no secrets). Tested in src/test/auth.test.ts.

export type Role = "user" | "owner";

/** Internal paths a normal user may be sent back to after login. Never external, never /studio. */
const SAFE_USER_PREFIXES = ["/", "/explore", "/search", "/you", "/post/"];

/** Returns a safe destination after login. Owner always lands in Studio; users only on allowlisted internal paths. */
export function destinationFor(role: Role, requested?: string | null): string {
  if (role === "owner") return requested && requested.startsWith("/studio") && isInternal(requested) ? requested : "/studio";
  if (!requested || !isInternal(requested)) return "/";
  const path = requested.split(/[?#]/)[0]!;
  if (path.startsWith("/studio") || path.startsWith("/login")) return "/";
  return SAFE_USER_PREFIXES.some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(p.endsWith("/") ? p : p + "/") || path === p)) ? requested : "/";
}

function isInternal(p: string): boolean {
  // Only single-slash absolute paths; blocks //evil.com, /\evil.com, schemes and control chars.
  return p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") && !/[\u0000-\u001f]/.test(p) && !/^\/[a-z]+:/i.test(p);
}

/** Server-side role decision from VERIFIED token claims + the configured owner uid. Client data is never an input. */
export function roleFromVerified(uid: string, claims: Record<string, unknown>, ownerUid: string | undefined): Role {
  if (ownerUid && uid === ownerUid) return "owner";
  if (claims["role"] === "owner") return "owner";
  return "user";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function validateCredentials(email: string, password: string): string | null {
  if (!EMAIL.test(email.trim())) return "Enter a valid email address.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  return null;
}

/** Maps Firebase error codes to safe messages. Wrong password and unknown email look identical (no account enumeration). */
export function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
    case "auth/invalid-login-credentials":
      return "Incorrect email or password.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Network problem. Check your connection and try again.";
    case "auth/email-already-in-use":
      return "Could not create the account. Try signing in instead.";
    case "auth/weak-password":
      return "Choose a stronger password (at least 6 characters).";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Client-side progressive backoff after repeated failures (Firebase also throttles server-side). */
export function backoffMs(failures: number): number {
  if (failures < 3) return 0;
  return Math.min(30_000, 1000 * 2 ** (failures - 3));
}
