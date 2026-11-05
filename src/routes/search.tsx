import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Page } from "@/components/lg";
import { PostTile } from "@/components/PostTile";
import { AdSlot } from "@/components/AdSlot";
import { postsQuery } from "@/lib/posts-query";
import { usePostStats } from "@/lib/use-post-stats";

export const Route = createFileRoute("/search")({
  validateSearch: z.object({ q: z.string().max(100).catch("") }),
  head: () => ({
    meta: [
      { title: "Search — LoopgramChannel" },
      { name: "description", content: "Search LoopgramChannel videos and Shorts." },
      { property: "og:title", content: "Search — LoopgramChannel" },
      { property: "og:description", content: "Search LoopgramChannel videos and Shorts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(postsQuery),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const nav = useNavigate();
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q) nav({ to: "/search", search: { q: text.trim() }, replace: true }); }, 300);
    return () => clearTimeout(t);
  }, [text]);
  const { data } = useSuspenseQuery(postsQuery);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? data.filter((p) => { const h = `${p.title} ${p.text} ${p.category}`.toLowerCase(); return words.every((w) => h.includes(w)); }) : [];
  const stats = usePostStats(hits.map((p) => p.id));
  return (
    <Page>
      <div className="p-4">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search videos" aria-label="Search"
          className="h-11 w-full rounded-full border bg-background px-5 outline-none focus:border-ring" />
      </div>
      {!q ? <p className="px-4 text-sm text-muted-foreground">Type to search videos.</p>
        : hits.length === 0 ? <p className="px-4 text-sm text-muted-foreground">No videos match “{q}”.</p>
        : (
          <div className="mx-auto max-w-4xl space-y-3 px-2 pb-6">
            {hits.map((p, i) => (
              <div key={p.id}>
                <PostTile post={p} compact views={stats[p.id]?.views} />
                {i === 2 && <AdSlot kind="search" className="mt-3" />}
              </div>
            ))}
          </div>
        )}
    </Page>
  );
}
