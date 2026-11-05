// Pure, testable job-queue rules shared by the SQS producer/consumer.
import type { SearchJob } from "./search-index";

export const MAX_RECEIVES = 5; // after this many failed deliveries a message is dead-lettered
/** Like/view delta for one post. `bid` is unique per message so a redelivered message is applied once. */
export type StatJob = { kind: "poststat"; bid: string; id: string; views: number; likes: number; dislikes: number };
/** "New owner video uploaded": picked up by scripts/sqs-transcode-worker.ts (ffmpeg), never by the web worker. */
export type TranscodeJob = { kind: "transcode"; key: string };
export type AnyJob = SearchJob | StatJob | TranscodeJob;
/** Owner source videos that get an HLS copy at the same stem hlsFor() looks up. */
export const TRANSCODE_SOURCE = /^media\/originals\/[\w-]+\.(mp4|mov|webm|m4v)$/;
export type QueueJob = AnyJob & { v: 1 };

/** Idempotency key: the same logical job always maps to the same key, so duplicate deliveries are skipped. */
export function jobKey(j: AnyJob): string {
  if (j.kind === "poststat") return `poststat:${j.bid}`;
  if (j.kind === "transcode") return `transcode:${j.key}`;
  return "reconcile";
}
const delta = (n: unknown) => Number.isInteger(n) && Math.abs(n as number) <= 1_000_000;
export function parseJob(body: string): QueueJob | null {
  try {
    const j = JSON.parse(body);
    if (j?.v !== 1) return null;
    if (j.kind === "reconcile") return j;
    if (j.kind === "transcode" && typeof j.key === "string" && TRANSCODE_SOURCE.test(j.key) && !j.key.includes("..")) return j;
    if (j.kind === "poststat" && typeof j.bid === "string" && /^[\w-]{8,64}$/.test(j.bid) && typeof j.id === "string" && /^[\w-]{1,80}$/.test(j.id)
      && delta(j.views) && delta(j.likes) && delta(j.dislikes)) return j;
    return null;
  } catch { return null; }
}
/** Sums deltas per post so many queued taps become one database write per post. */
export function coalesceStats(jobs: StatJob[]): Map<string, { views: number; likes: number; dislikes: number }> {
  const m = new Map<string, { views: number; likes: number; dislikes: number }>();
  for (const j of jobs) {
    const p = m.get(j.id) ?? { views: 0, likes: 0, dislikes: 0 };
    m.set(j.id, { views: p.views + j.views, likes: p.likes + j.likes, dislikes: p.dislikes + j.dislikes });
  }
  return m;
}
/** Exponential backoff with full jitter, in seconds, capped at 15 minutes (SQS visibility limit we allow). */
export function backoffSeconds(receiveCount: number, rand = Math.random()): number {
  const cap = Math.min(900, 10 * 2 ** Math.max(0, receiveCount - 1));
  return Math.max(1, Math.floor(cap * rand));
}
/** What to do with a failed message. Permanent errors and exhausted retries go to the dead-letter list. */
export function failureAction(receiveCount: number, permanent: boolean): "retry" | "dead" {
  return permanent || receiveCount >= MAX_RECEIVES ? "dead" : "retry";
}
