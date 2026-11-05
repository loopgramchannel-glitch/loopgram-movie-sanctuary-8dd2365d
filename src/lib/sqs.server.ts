// Server-only SQS producer/consumer. Uses AWS_* credentials and SQS_QUEUE_URL.
import { AwsClient } from "aws4fetch";
import { redis, redisPipeline } from "./backend.server";
import { backoffSeconds, failureAction, jobKey, parseJob, type AnyJob, type QueueJob, type StatJob } from "./jobs";
import { log } from "./log.server";
import type { SearchJob } from "./search-index";

const DEAD_KEY = "lg:jobs:dead";

async function sqs(target: string, body: Record<string, unknown>) {
  const url = process.env["SQS_QUEUE_URL"];
  if (!url) throw new Error("SQS_QUEUE_URL missing");
  const region = process.env["AWS_REGION"] || "eu-north-1";
  const c = new AwsClient({ accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "", secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "", region, service: "sqs" });
  const r = await c.fetch(`https://sqs.${region}.amazonaws.com/`, {
    method: "POST", signal: AbortSignal.timeout(5000),
    headers: { "X-Amz-Target": `AmazonSQS.${target}`, "Content-Type": "application/x-amz-json-1.0" },
    body: JSON.stringify({ QueueUrl: url, ...body }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQS ${target} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}

/** Producer. Returns false (never throws) when the queue is unavailable so callers can run the job inline. */
export async function sendJob(job: AnyJob): Promise<boolean> {
  try { await sqs("SendMessage", { MessageBody: JSON.stringify({ ...job, v: 1 } satisfies QueueJob) }); return true; }
  catch (e) { log("warn", "sqs.send_failed", { job: jobKey(job), error: String(e) }); return false; }
}

type Handler = (j: SearchJob & { v: 1 }) => Promise<unknown>;
/** Consumer: one batch. Safe for duplicate delivery (Redis done-marker per job key per 10 min). */
export async function processBatch(handle: Handler, max = 10) {
  const r = await sqs("ReceiveMessage", { MaxNumberOfMessages: Math.min(10, max), VisibilityTimeout: 60, WaitTimeSeconds: 0, MessageSystemAttributeNames: ["ApproximateReceiveCount"] });
  const out = { received: 0, done: 0, duplicate: 0, retried: 0, dead: 0, stats: 0 };
  // Like/view deltas: summed per post and written to DynamoDB together (exactly-once per message).
  const msgs = (r.Messages ?? []) as any[];
  const statMsgs = msgs.filter((m) => parseJob(m.Body)?.kind === "poststat");
  if (statMsgs.length) {
    const { applyStatJobs } = await import("./post-stats.server");
    try {
      await applyStatJobs(statMsgs.map((m) => parseJob(m.Body) as StatJob & { v: 1 }));
      await Promise.all(statMsgs.map((m) => sqs("DeleteMessage", { ReceiptHandle: m.ReceiptHandle }).catch(() => {})));
      out.received += statMsgs.length; out.stats += statMsgs.length; out.done += statMsgs.length;
    } catch (e) {
      out.received += statMsgs.length; out.retried += statMsgs.length; // stay invisible, SQS redelivers later
      log("warn", "sqs.stats_retry", { n: statMsgs.length, error: String(e).slice(0, 200) });
    }
  }
  for (const m of msgs) {
    if (statMsgs.includes(m)) continue;
    out.received++;
    // Transcode jobs need ffmpeg: hand them straight back for scripts/sqs-transcode-worker.ts.
    if (parseJob(m.Body)?.kind === "transcode") { await sqs("ChangeMessageVisibility", { ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: 0 }).catch(() => {}); continue; }
    const count = Number(m.Attributes?.ApproximateReceiveCount ?? 1);
    const job = parseJob(m.Body);
    const del = () => sqs("DeleteMessage", { ReceiptHandle: m.ReceiptHandle });
    if (!job) { await redisPipeline([["LPUSH", DEAD_KEY, JSON.stringify({ id: m.MessageId, reason: "invalid" })], ["LTRIM", DEAD_KEY, 0, 999]]); await del(); out.dead++; continue; }
    const key = `lg:jobs:done:${jobKey(job)}`;
    if ((await redis(["GET", key])) === "1") { await del(); out.duplicate++; continue; }
    try {
      await handle(job as SearchJob & { v: 1 });
      await redis(["SET", key, "1", "EX", 600]);
      await del(); out.done++;
    } catch (e) {
      const permanent = /\b4\d\d\b/.test(String(e)) && !/\b429\b/.test(String(e));
      if (failureAction(count, permanent) === "dead") {
        await redisPipeline([["LPUSH", DEAD_KEY, JSON.stringify({ id: m.MessageId, job, reason: String(e).slice(0, 200) })], ["LTRIM", DEAD_KEY, 0, 999]]);
        await del(); out.dead++;
        log("error", "sqs.dead_letter", { job: jobKey(job), receives: count, error: String(e) });
      } else {
        await sqs("ChangeMessageVisibility", { ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: backoffSeconds(count) }).catch(() => {});
        out.retried++;
        log("warn", "sqs.retry", { job: jobKey(job), receives: count, error: String(e) });
      }
    }
  }
  return out;
}
export async function queueStats() {
  const a = await sqs("GetQueueAttributes", { AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"] });
  const dead = Number((await redis(["LLEN", DEAD_KEY])) ?? 0);
  return { waiting: Number(a.Attributes?.ApproximateNumberOfMessages ?? 0), inFlight: Number(a.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0), dead };
}
