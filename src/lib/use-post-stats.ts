// Browser hooks: live counts, YouTube-style optimistic like toggle, and watch-time view counting.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { countPostView, getMyVote, getPostStats, votePost } from "./post-stats.functions";
import { nextVote, VIEW_AFTER_SHORT_S, VIEW_AFTER_VIDEO_S, voteDelta, type PostStats, type Vote } from "./post-stats";

export function viewerId(): string {
  const k = "lg:viewer";
  let v = localStorage.getItem(k);
  if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) {
    v = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(k, v);
  }
  return v;
}

const statsKey = (ids: string[]) => ["post-stats", [...ids].sort().join(",")];

/** Views + likes for many posts in one request (cards, feeds). */
export function usePostStats(ids: string[]): Record<string, PostStats> {
  const list = [...new Set(ids)].slice(0, 100);
  const q = useQuery({
    queryKey: statsKey(list), enabled: list.length > 0, staleTime: 30_000,
    queryFn: () => getPostStats({ data: { ids: list } }),
  });
  return q.data ?? {};
}

/** One post: counts + this viewer's thumb, with instant (optimistic) updates. */
export function usePostEngagement(id: string, short: boolean, active = true) {
  const qc = useQueryClient();
  const stats = usePostStats([id])[id];
  const [vote, setVoteState] = useState<Vote>(0);
  const [likes, setLikes] = useState<number | null>(null);
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => { setLikes(null); setViews(null); setVoteState((Number(localStorage.getItem(`lg:vote:${id}`)) || 0) as Vote); }, [id]);
  useEffect(() => { if (stats) { setLikes((l) => l ?? stats.likes); setViews((v) => v ?? stats.views); } }, [stats]);
  useEffect(() => {
    let off = false;
    getMyVote({ data: { id, viewer: viewerId() } }).then((r) => { if (!off && r.vote) { setVoteState(r.vote); localStorage.setItem(`lg:vote:${id}`, String(r.vote)); } }).catch(() => {});
    return () => { off = true; };
  }, [id]);

  // A view counts only after real watching time with the tab visible (YouTube counts intent, not loads).
  const sent = useRef("");
  useEffect(() => {
    if (!active) return;
    const need = (short ? VIEW_AFTER_SHORT_S : VIEW_AFTER_VIDEO_S) * 1000;
    let watched = 0, last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible") watched += now - last;
      last = now;
      if (watched >= need && sent.current !== id) {
        sent.current = id; clearInterval(t);
        countPostView({ data: { id, viewer: viewerId() } }).then((r) => {
          if (r.counted) { setViews((v) => (v ?? 0) + 1); qc.invalidateQueries({ queryKey: ["post-stats"] }); }
        }).catch(() => {});
      }
    }, 500);
    return () => clearInterval(t);
  }, [id, short, qc, active]);

  const tap = (t: 1 | -1) => {
    const prev = vote, n = nextVote(prev, t);
    setVoteState(n); localStorage.setItem(`lg:vote:${id}`, String(n));
    setLikes((l) => Math.max(0, (l ?? 0) + voteDelta(prev, n).likes));
    votePost({ data: { id, viewer: viewerId(), vote: n } })
      .then((r) => { setLikes(r.likes); qc.invalidateQueries({ queryKey: ["post-stats"] }); })
      .catch(() => { setVoteState(prev); localStorage.setItem(`lg:vote:${id}`, String(prev)); setLikes((l) => Math.max(0, (l ?? 0) - voteDelta(prev, n).likes)); });
  };
  return { vote, likes: likes ?? 0, views: views ?? 0, tap };
}
