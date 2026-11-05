import { createFileRoute } from "@tanstack/react-router";
import { redis } from "@/lib/backend.server";

// Readiness check: reports dependency status only (no secrets, no data).
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        const t0 = Date.now();
        const r = await redis(["PING"]).then((v) => v === "PONG").catch(() => false);
        const ok = true; // Redis is optional (fails open)
        // Always 200 so the check itself never shows as a crash; read "ok" for readiness.
        return Response.json({ ok, status: ok ? "ready" : "degraded", redis: r, ms: Date.now() - t0 }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
