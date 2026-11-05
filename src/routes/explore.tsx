import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Flame, Gamepad2, Music2, Newspaper, Film, Mic, Trophy, Sparkles } from "lucide-react";
import { Page } from "@/components/lg";
import { VideoGrid } from "@/components/VideoFeed";
import { postsQuery } from "@/lib/posts-query";
import { usePostStats } from "@/lib/use-post-stats";
import { AdSlot } from "@/components/AdSlot";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "Explore — LoopgramChannel" },
      { name: "description", content: "Trending videos and categories on LoopgramChannel: music, gaming, news and more." },
      { property: "og:title", content: "Explore — LoopgramChannel" },
      { property: "og:description", content: "Trending videos and categories on LoopgramChannel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(postsQuery),
  component: Explore,
});

const ICONS: Record<string, typeof Flame> = { music: Music2, gaming: Gamepad2, news: Newspaper, movies: Film, podcasts: Mic, sports: Trophy };

function Explore() {
  const { data } = useSuspenseQuery(postsQuery);
  const stats = usePostStats(data.map((p) => p.id));
  const cats = [...new Set(data.map((p) => p.category).filter(Boolean))];
  const trending = [...data].sort((a, b) => (stats[b.id]?.views ?? 0) - (stats[a.id]?.views ?? 0) || b.createdAt - a.createdAt).slice(0, 12);
  return (
    <Page>
      <h1 className="px-4 pt-4 text-2xl font-bold">Explore</h1>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <a href="#trending" className="flex items-center gap-3 rounded-xl bg-secondary p-4 font-semibold hover:bg-accent"><Flame className="h-6 w-6 text-primary" />Trending</a>
        <Link to="/" search={{ c: "Shorts" }} className="flex items-center gap-3 rounded-xl bg-secondary p-4 font-semibold hover:bg-accent"><Sparkles className="h-6 w-6 text-primary" />Shorts</Link>
        {cats.map((c) => {
          const Icon = ICONS[c.toLowerCase()] ?? Sparkles;
          return <Link key={c} to="/" search={{ c }} className="flex items-center gap-3 rounded-xl bg-secondary p-4 font-semibold hover:bg-accent"><Icon className="h-6 w-6 text-primary" />{c}</Link>;
        })}
      </div>
      <AdSlot kind="home" className="px-4 pb-4" />
      <h2 id="trending" className="flex items-center gap-2 px-4 pb-3 text-lg font-bold"><Flame className="h-5 w-5 text-primary" />Trending</h2>
      {trending.length ? <VideoGrid list={trending} views={stats} /> : <p className="px-4 text-sm text-muted-foreground">Nothing posted yet.</p>}
    </Page>
  );
}
