// Real-time transcoder: pulls { kind: "transcode", key } jobs from SQS_QUEUE_URL, converts with ffmpeg, uploads HLS to R2.
//   bun scripts/sqs-transcode-worker.ts          (runs forever; run several copies to scale out)
//   bun scripts/sqs-transcode-worker.ts --drain  (exits once the queue has no transcode jobs; used by GitHub Actions)
// Needs ffmpeg + AWS_* / SQS_QUEUE_URL + R2_* (+ optional UPSTASH_*) env vars. Safe for duplicate delivery:
// convertOne() skips stems that already have index.m3u8. Other job kinds are handed straight back to the queue.
import { AwsClient } from "aws4fetch";
import { MAX_RECEIVES, parseJob } from "../src/lib/jobs";
import { convertOne } from "./convert-posts";

const url = process.env["SQS_QUEUE_URL"];
if (!url) { console.error("SQS_QUEUE_URL missing"); process.exit(1); }
const region = process.env["AWS_REGION"] || "eu-north-1";
const aws = new AwsClient({ accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "", secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "", region, service: "sqs" });
const drain = process.argv.includes("--drain");

async function sqs(target: string, body: Record<string, unknown>) {
  const r = await aws.fetch(`https://sqs.${region}.amazonaws.com/`, {
    method: "POST",
    headers: { "X-Amz-Target": `AmazonSQS.${target}`, "Content-Type": "application/x-amz-json-1.0" },
    body: JSON.stringify({ QueueUrl: url, ...body }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQS ${target} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}

let stop = false;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stop = true; console.log("Stopping after current job…"); });

let idle = 0;
while (!stop) {
  let r: any;
  try { r = await sqs("ReceiveMessage", { MaxNumberOfMessages: 1, VisibilityTimeout: 900, WaitTimeSeconds: 20, MessageSystemAttributeNames: ["ApproximateReceiveCount"] }); }
  catch (e) { console.error(String(e)); await Bun.sleep(5000); continue; }
  const m = r.Messages?.[0];
  const job = m ? parseJob(m.Body) : null;
  if (!m || job?.kind !== "transcode") {
    if (m) await sqs("ChangeMessageVisibility", { ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: 0 }).catch(() => {});
    if (drain && ++idle >= 2) break;
    continue;
  }
  idle = 0;
  // Keep the job hidden from other workers while a long movie converts.
  const keepAlive = setInterval(() => { sqs("ChangeMessageVisibility", { ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: 900 }).catch(() => {}); }, 300_000);
  try {
    const res = await convertOne(job.key);
    await sqs("DeleteMessage", { ReceiptHandle: m.ReceiptHandle });
    console.log(`${res} ${job.key}`);
  } catch (e) {
    const n = Number(m.Attributes?.ApproximateReceiveCount ?? 1);
    console.error(`Failed ${job.key} (try ${n}):`, e instanceof Error ? e.message : e);
    // Give up after MAX_RECEIVES; the 10-minute scan in convert-posts.ts still retries it later.
    if (n >= MAX_RECEIVES) await sqs("DeleteMessage", { ReceiptHandle: m.ReceiptHandle }).catch(() => {});
    else await sqs("ChangeMessageVisibility", { ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: 60 * n }).catch(() => {});
  } finally { clearInterval(keepAlive); }
}
console.log("Worker stopped.");
