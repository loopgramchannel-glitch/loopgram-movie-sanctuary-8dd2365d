// Structured, sanitized logging. Always writes JSON to the platform log; also ships to CloudWatch Logs
// (CLOUDWATCH_LOG_GROUP) in small batches when the AWS user is allowed to. Never throws.
import { AwsClient } from "aws4fetch";
import { scrub } from "./log-sanitize";

type Level = "info" | "warn" | "error";
const buf: { timestamp: number; message: string }[] = [];
let streamReady = false, cwDisabledUntil = 0, lastFlush = 0;
const STREAM = `app-${new Date().toISOString().slice(0, 10)}`;

export function log(level: Level, event: string, ctx: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(ctx) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
  if (buf.length < 500) buf.push({ timestamp: Date.now(), message: line });
  if (level === "error" || Date.now() - lastFlush > 10_000) void flushLogs();
}

async function cw(target: string, body: unknown) {
  const region = process.env["AWS_REGION"] || "eu-north-1";
  const c = new AwsClient({ accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "", secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "", region, service: "logs" });
  const r = await c.fetch(`https://logs.${region}.amazonaws.com/`, {
    method: "POST", signal: AbortSignal.timeout(3000),
    headers: { "X-Amz-Target": `Logs_20140328.${target}`, "Content-Type": "application/x-amz-json-1.1" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); if (!/ResourceAlreadyExists/.test(t)) throw new Error(`CloudWatch ${target} ${r.status}: ${t.slice(0, 160)}`); }
}

/** Returns whether events were delivered. On permission errors it backs off for 10 minutes. */
export async function flushLogs(): Promise<boolean> {
  const group = process.env["CLOUDWATCH_LOG_GROUP"];
  if (!group || !buf.length || Date.now() < cwDisabledUntil) return false;
  lastFlush = Date.now();
  const events = buf.splice(0, buf.length);
  try {
    if (!streamReady) { await cw("CreateLogStream", { logGroupName: group, logStreamName: STREAM }); streamReady = true; }
    await cw("PutLogEvents", { logGroupName: group, logStreamName: STREAM, logEvents: events });
    return true;
  } catch (e) {
    cwDisabledUntil = Date.now() + 10 * 60_000;
    console.warn(JSON.stringify({ level: "warn", event: "cloudwatch.unavailable", error: String(e).slice(0, 200) }));
    return false;
  }
}
