import { createFileRoute } from "@tanstack/react-router";

// Operator/scheduler endpoint: runs one batch of queued background jobs and reports queue health.
// Requires `Authorization: Bearer <SEARCH_SYNC_SECRET>`.
function authorized(req: Request) {
  const s = process.env["SEARCH_SYNC_SECRET"];
  const h = req.headers.get("authorization") ?? "";
  const want = `Bearer ${s}`;
  if (!s || h.length !== want.length) return false;
  let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}
export const Route = createFileRoute("/api/public/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const task = new URL(request.url).searchParams.get("task") ?? "queue";
        const { log, flushLogs } = await import("@/lib/log.server");
        // ?task=posts → rebuild posts search; default → drain one queue batch.
        if (task === "posts") {
          const { reconcilePosts } = await import("@/lib/algolia.server");
          const r = await reconcilePosts().catch((e) => ({ error: String(e).slice(0, 200) }));
          await flushLogs();
          return Response.json({ ok: !("error" in r), result: r });
        }
        const { processBatch, queueStats } = await import("@/lib/sqs.server");
        const { handleSearchJob } = await import("@/lib/algolia.server");
        try {
          const batch = await processBatch((j) => handleSearchJob(j));
          const stats = await queueStats().catch(() => null);
          log("info", "jobs.batch", { ...batch, ...(stats ?? {}) });
          await flushLogs();
          return Response.json({ ok: true, batch, stats });
        } catch (e) {
          log("error", "jobs.batch_failed", { error: String(e) });
          await flushLogs();
          // 200 + ok:false (like /api/public/health): an unavailable queue is a reported state, not a crash.
          return Response.json({ ok: false, error: "Queue unavailable" }, { headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
