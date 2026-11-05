// YouTube-style home feed: category chips, 16:9 video grid, Shorts shelf and AdSense in-feed slots.
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { PostTile } from "@/components/PostTile";
import { postsQuery } from "@/lib/posts-query";
import { postIsShort, useRatios } from "@/components/PostView";
import { ShortTile, ShortsShelf } from "@/components/Shorts";
import { AdSlot } from "@/components/AdSlot";
import { adPositions } from "@/lib/ads";
import { useAuth } from "@/hooks/useAuth";
import { usePostStats } from "@/lib/use-post-stats";
import type { PostT } from "@/lib/posts";

export function VideoGrid({ list, views }: { list: PostT[]; views: Record<string, { views?: number } | undefined> }) {
  const { settings } = useAuth();
  const adAt = new Set(adPositions(list.length, settings?.adFeedEvery ?? 8));
  return (
    <div className="grid grid-cols-1 gap-y-6 pb-6 sm:grid-cols-2 sm:gap-x-4 sm:px-4 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((p, i) => (
        <Fragment key={p.id}>
          <PostTile post={p} views={views[p.id]?.views} />
          {adAt.has(i) && <AdSlot kind="feed" className="px-4 sm:px-0" />}
        </Fragment>
      ))}
    </div>
  );
}

export function VideoFeed({ c }: { c?: string | undefined }) {
  const { data } = useSuspenseQuery(postsQuery);
  const ratios = useRatios(data.map((p) => p.videoUrl));
  const short = (p: PostT) => postIsShort(p, ratios);
  const stats = usePostStats(data.map((p) => p.id));
  const cats = [...new Set(data.map((p) => p.category).filter(Boolean))];
  const inCat = c && c !== "Shorts" && c !== "Videos" ? data.filter((p) => p.category === c) : data;
  const shorts = inCat.filter(short);
  const videos = inCat.filter((p) => !short(p));
  const chip = (on: boolean) => `shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-foreground text-background" : "bg-secondary hover:bg-accent"}`;
  const empty = (t: string) => <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t}</p>;
  return (
    <>
      <div className="scrollbar-none sticky top-14 z-20 flex gap-3 overflow-x-auto bg-background px-4 py-3">
        <Link to="/" search={{}} className={chip(!c)}>All</Link>
        <Link to="/" search={{ c: "Shorts" }} className={chip(c === "Shorts")}>Shorts</Link>
        <Link to="/" search={{ c: "Videos" }} className={chip(c === "Videos")}>Videos</Link>
        {cats.map((x) => <Link key={x} to="/" search={{ c: x }} className={chip(c === x)}>{x}</Link>)}
      </div>
      <AdSlot kind="home" className="px-4 pb-4" />
      {inCat.length === 0 ? empty("Nothing posted here yet.")
        : c === "Shorts" ? (shorts.length
          ? <div className="grid grid-cols-2 gap-2 px-2 pb-6 sm:grid-cols-3 sm:px-4 lg:grid-cols-5 xl:grid-cols-6">{shorts.map((p) => <ShortTile key={p.id} post={p} className="w-full" />)}</div>
          : empty("No Shorts yet."))
        : c === "Videos" ? (videos.length ? <VideoGrid list={videos} views={stats} /> : empty("No videos yet."))
        : (
          <>
            <VideoGrid list={videos.slice(0, 8)} views={stats} />
            <ShortsShelf posts={shorts} />
            <VideoGrid list={videos.slice(8)} views={stats} />
          </>
        )}
    </>
  );
}
