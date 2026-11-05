// Shared posts query (used by /posts, /post/$id and the home shelf) so all views share one cache entry.
import { queryOptions } from "@tanstack/react-query";
import { getPosts, getPublicPost } from "@/lib/posts.functions";

export const postsQuery = queryOptions({ queryKey: ["posts"], queryFn: () => getPosts(), staleTime: 30_000 });

/** One post, checked against its authoritative database state (unpublished/deleted → null). */
export const postQuery = (id: string) =>
  queryOptions({ queryKey: ["post", id], queryFn: () => getPublicPost({ data: { id } }), staleTime: 15_000 });

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  const steps: [number, string][] = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [n, u] of steps) if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? "s" : ""} ago`; }
  return "just now";
}
