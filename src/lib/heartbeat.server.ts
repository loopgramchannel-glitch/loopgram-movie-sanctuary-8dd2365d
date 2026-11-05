// Site-wide background heartbeat: at most once a minute (Redis gate shared by every server instance)
// it drains a small batch of queued jobs. Runs after the response via waitUntil, so visitors never wait.
// Every step is idempotent, so an instance being stopped mid-run only means the same work is retried.
import { onceEvery, redis } from "./backend.server";

export async function heartbeat() {
  if (!onceEvery("heartbeat", 30_000)) return; // cheap local gate before touching Redis
  const go = await redis(["SET", "lg:heartbeat", "1", "NX", "EX", 60]).catch(() => null);
  if (go !== "OK") return;
  const { log, flushLogs } = await import("./log.server");
  try {
    // Owner switch (Studio → Settings → Background work). Unreadable settings = on.
    const raw = await (await import("./settings-store.server")).readSettingsRaw().catch(() => null);
    let s: { autoQueue?: boolean } | null = null; try { s = raw ? JSON.parse(raw) : null; } catch { /* defaults */ }
    let batch: unknown = "paused";
    if (s?.autoQueue !== false) {
      const { processBatch } = await import("./queue.server");
      const { handleSearchJob } = await import("./algolia.server");
      batch = await Promise.all([1, 2, 3].map(() => processBatch(handleSearchJob, 10))).catch((e) => ({ error: String(e).slice(0, 200) }));
    }
    log("info", "heartbeat", { batch });
  } finally {
    await flushLogs().catch(() => {});
  }
}
