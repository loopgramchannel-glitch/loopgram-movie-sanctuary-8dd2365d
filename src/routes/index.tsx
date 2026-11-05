import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Page } from "@/components/lg";
import { VideoFeed } from "@/components/VideoFeed";
import { postsQuery } from "@/lib/posts-query";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ c: z.string().max(40).optional() }),
  head: () => ({
    meta: [
      { title: "LoopgramChannel — Videos, Shorts, music & gaming" },
      { name: "description", content: "Watch the latest videos and Shorts from LoopgramChannel: gaming, music, news and more." },
      { property: "og:title", content: "LoopgramChannel — Videos, Shorts, music & gaming" },
      { property: "og:description", content: "Watch the latest videos and Shorts from LoopgramChannel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(postsQuery),
  component: Home,
});

function Home() {
  const { c } = Route.useSearch();
  return (
    <Page>
      <h1 className="sr-only">LoopgramChannel videos</h1>
      <VideoFeed c={c} />
    </Page>
  );
}
