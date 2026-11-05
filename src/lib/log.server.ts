// Structured, sanitized logging to the platform log (JSON lines). Never throws.
import { scrub } from "./log-sanitize";

type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, ctx: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(ctx) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/** Kept for callers that flush at the end of a request; logs are written immediately. */
export async function flushLogs(): Promise<boolean> {
  return true;
}
