// YouTube-style video card: 16:9 thumbnail, channel avatar, 2-line title, meta line.
import { Link } from "@tanstack/react-router";
import type { PostT } from "@/lib/posts";
import { PostThumb, SourceBadge } from "@/components/PostView";
import { timeAgo } from "@/lib/posts-query";
import { viewsLabel } from "@/lib/post-stats";

export function PostTile({ post, compact = false, views }: { post: PostT; compact?: boolean; views?: number | undefined }) {
  const v = views ? `${viewsLabel(views)} · ` : "";
  const title = post.title || post.text.slice(0, 90) || "Video";
  if (compact) {
    return (
      <Link to="/post/$id" params={{ id: post.id }} className="flex gap-3 rounded-lg p-1 hover:bg-accent">
        <div className="relative w-40 shrink-0">
          <PostThumb post={post} className="aspect-video w-full rounded-lg" />
          <SourceBadge url={post.videoUrl} className="absolute bottom-1 right-1 bg-background/90" />
        </div>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">LoopgramChannel</p>
          <p className="text-xs text-muted-foreground">{v}{timeAgo(post.createdAt)}</p>
        </div>
      </Link>
    );
  }
  return (
    <Link to="/post/$id" params={{ id: post.id }} className="group block">
      <div className="relative overflow-hidden sm:rounded-xl">
        <PostThumb post={post} className="aspect-video w-full transition-transform group-hover:scale-[1.02]" />
        <SourceBadge url={post.videoUrl} className="absolute bottom-2 right-2 bg-background/90" />
      </div>
      <div className="flex gap-3 px-3 pt-3 sm:px-0">
        <img src="/icon.svg" alt="" className="h-9 w-9 shrink-0 rounded-full bg-secondary p-1" />
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-semibold leading-snug">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">LoopgramChannel · {post.category ? `${post.category} · ` : ""}{v}{timeAgo(post.createdAt)}</p>
        </div>
      </div>
    </Link>
  );
}
