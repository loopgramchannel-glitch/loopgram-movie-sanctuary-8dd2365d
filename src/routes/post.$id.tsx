import { shareLink } from "@/lib/share";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, ExternalLink, Share2, ThumbsUp, ThumbsDown } from "lucide-react";
import { PostVideo, postIsShort, useRatios } from "@/components/PostView";
import { ShortsPlayer } from "@/components/Shorts";
import { parseVideoSource } from "@/lib/video-source";
import { PostTile } from "@/components/PostTile";
import { usePostEngagement, usePostStats } from "@/lib/use-post-stats";
import { formatCount, viewsLabel } from "@/lib/post-stats";
import { postQuery, postsQuery, timeAgo } from "@/lib/posts-query";

export const Route = createFileRoute("/post/$id")({
  head: () => ({
    meta: [
      { title: "Watch — LoopgramChannel" },
      { name: "description", content: "Watch this LoopgramChannel video, then keep going with up-next videos." },
      { property: "og:title", content: "Watch — LoopgramChannel" },
      { property: "og:description", content: "Watch this LoopgramChannel video and more up next." },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context, params }) => Promise.all([
    context.queryClient.ensureQueryData(postsQuery),
    context.queryClient.ensureQueryData(postQuery(params.id)),
  ]),
  component: PostWatch,
});

function PostWatch() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(postsQuery);
  // Authoritative check: the post comes from its own database row, not the cached list.
  const { data: post } = useSuspenseQuery(postQuery(id));
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); window.scrollTo(0, 0); }, [id]);
  const ratios = useRatios(data.map((p) => p.videoUrl).concat(post?.videoUrl ? [post.videoUrl] : []));
  const isShort = !!post && postIsShort(post, ratios);
  const eng = usePostEngagement(id, isShort, !isShort);
  const vote = eng.vote;
  const upStats = usePostStats(data.slice(0, 100).map((p) => p.id));
  const setV = (v: 0 | 1 | -1) => { if (v !== 0) eng.tap(v); };

  if (!post) return <div className="p-8 text-center"><p className="mb-3">This video isn't available.</p><Link to="/" className="text-primary">Browse videos</Link></div>;
  const upNext = data.filter((p) => p.id !== id && !(postIsShort(p, ratios)));
  const share = () => shareLink({ title: post.title, text: `Watch ${post.title || "this"} on LoopgramChannel`, url: location.href });
  // Vertical (9:16) videos open full screen like YouTube Shorts; swipe or arrows move between Shorts.
  if (postIsShort(post, ratios)) {
    const shorts = data.filter((p) => postIsShort(p, ratios));
    const list = shorts.some((p) => p.id === id) ? shorts : [post, ...shorts];
    const shareShort = async (p: typeof post) => {
      shareLink({ title: p.title, text: `Watch ${p.title || "this"} on LoopgramChannel`, url: `${location.origin}/post/${p.id}` });
    };
    return <ShortsPlayer shorts={list} startId={id} onShare={(p) => { void shareShort(p); }} />;
  }
  const pill = "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-accent";
  const isFile = post.videoUrl && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(post.videoUrl);
  const srcInfo = post.videoUrl ? parseVideoSource(post.videoUrl) : null;
  const ext = srcInfo && srcInfo.embed ? srcInfo : null;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 lg:flex-row lg:px-6 lg:pt-4">
      <div className="contents lg:block lg:min-w-0 lg:flex-1">
        {/* Sticky player: stays pinned under the header while the page scrolls (mobile), like YouTube. */}
        <div className="bg-background">
          {post.videoUrl ? <PostVideo url={post.videoUrl} poster={post.imageUrl} />
            : post.imageUrl ? <img src={post.imageUrl} alt={post.title} className="max-h-[70vh] w-full object-contain sm:rounded-xl" /> : null}
        </div>
        <div className="px-3 pt-3 lg:px-0">
          <h1 className="text-lg font-bold leading-snug sm:text-xl">{post.title || "Video"}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3">
              <img src="/icon.svg" alt="" className="h-10 w-10 rounded-full bg-secondary p-1" />
              <div><p className="text-sm font-semibold">LoopgramChannel</p><p className="text-xs text-muted-foreground">Official channel</p></div>
            </div>
            <div className="scrollbar-none -mx-3 flex w-full gap-2 overflow-x-auto px-3 sm:mx-0 sm:ml-auto sm:w-auto sm:px-0">
              <div className="flex shrink-0 overflow-hidden rounded-full bg-secondary">
                <button onClick={() => setV(1)} aria-pressed={vote === 1} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm hover:bg-accent"><ThumbsUp className={`h-4 w-4 ${vote === 1 ? "fill-current" : ""}`} />{eng.likes ? formatCount(eng.likes) : "Like"}</button>
                <span className="my-2 w-px bg-border" />
                <button onClick={() => setV(-1)} aria-pressed={vote === -1} aria-label="Dislike" className="px-4 py-2 hover:bg-accent"><ThumbsDown className={`h-4 w-4 ${vote === -1 ? "fill-current" : ""}`} /></button>
              </div>
              <button onClick={() => { share() }} className={pill}><Share2 className="h-4 w-4" />Share</button>
              {isFile && <a href={post.videoUrl} download className={pill}><Download className="h-4 w-4" />Download</a>}
              {ext && <a href={post.videoUrl} target="_blank" rel="noopener noreferrer" className={pill}><ExternalLink className="h-4 w-4" />Open on {ext.label}</a>}
            </div>
          </div>
          <button onClick={() => setMore((m) => !m)} className="mt-3 block w-full rounded-xl bg-secondary p-3 text-left text-sm hover:bg-accent">
            <p className="font-semibold" suppressHydrationWarning>{viewsLabel(eng.views)} · {timeAgo(post.createdAt)}{post.category ? ` · #${post.category}` : ""}</p>
            {post.text && <p className={`mt-1 whitespace-pre-line ${more ? "" : "line-clamp-2"}`}>{post.text}</p>}
            {post.text && post.text.length > 120 && <span className="mt-1 inline-block font-semibold">{more ? "Show less" : "...more"}</span>}
          </button>
        </div>
      </div>
      <aside className="px-3 pb-6 lg:w-[400px] lg:shrink-0 lg:px-0">
        <h2 className="mb-2 font-bold">Up next</h2>
        <div className="space-y-2">{upNext.length ? upNext.map((p) => <PostTile key={p.id} post={p} compact views={upStats[p.id]?.views} />) : <p className="text-sm text-muted-foreground">No other videos yet.</p>}</div>
      </aside>
    </div>
  );
}
