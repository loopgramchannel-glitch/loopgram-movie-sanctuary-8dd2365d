// Public view/like endpoints for owner posts. Anonymous viewer id is a random browser id; the server dedupes.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const pid = z.string().regex(/^[a-z0-9-]{3,64}$/);
const viewer = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

async function ip() {
  const { clientIp } = await import("./backend.server");
  try { return clientIp(getRequest()); } catch { return "anon"; }
}

export const getPostStats = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ ids: z.array(pid).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { readStats } = await import("./post-stats.server");
    return readStats(data.ids);
  });

export const getMyVote = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: pid, viewer }).parse(d))
  .handler(async ({ data }) => {
    const { getVote } = await import("./post-stats.server");
    return { vote: await getVote(data.id, data.viewer) };
  });

export const countPostView = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: pid, viewer }).parse(d))
  .handler(async ({ data }) => {
    const { recordView } = await import("./post-stats.server");
    return recordView(data.id, data.viewer, await ip());
  });

export const votePost = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: pid, viewer, vote: z.union([z.literal(0), z.literal(1), z.literal(-1)]) }).parse(d))
  .handler(async ({ data }) => {
    const { setVote } = await import("./post-stats.server");
    const r = await setVote(data.id, data.viewer, await ip(), data.vote);
    if (!r) throw new Error("Too many taps — try again in a minute.");
    return r;
  });
