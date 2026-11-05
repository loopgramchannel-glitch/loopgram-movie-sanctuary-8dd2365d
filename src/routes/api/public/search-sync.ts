import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Operator-only endpoint to rebuild / retry / update the search index.
// Requires `Authorization: Bearer <SEARCH_SYNC_SECRET>`; anyone else gets 401.
function authorized(req: Request) {
  const s = process.env["SEARCH_SYNC_SECRET"];
  const h = req.headers.get("authorization") ?? "";
  if (!s || h.length !== s.length + 7) return false;
  const a = new TextEncoder().encode(h), b = new TextEncoder().encode(`Bearer ${s}`);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reconcile") }),
  z.object({ kind: z.literal("retry") }),
]);

export const Route = createFileRoute("/api/public/search-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
        const { handleSearchJob, retryFailed } = await import("@/lib/algolia.server");
        try {
          const j = parsed.data;
          const result = j.kind === "retry" ? await retryFailed() : await handleSearchJob(j);
          return Response.json({ ok: true, result });
        } catch (e) {
          console.error(JSON.stringify({ flow: "algolia", route: "search-sync", error: String(e).slice(0, 300) }));
          return Response.json({ ok: false, error: "Index update failed; safe to retry" }, { status: 502 });
        }
      },
    },
  },
});
