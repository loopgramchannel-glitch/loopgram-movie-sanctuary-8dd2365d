// Looks up the real public title of a pasted video link via each platform's official oEmbed endpoint.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseVideoSource } from "@/lib/video-source";

const OEMBED: Partial<Record<string, string>> = {
  youtube: "https://www.youtube.com/oembed?format=json&url=",
  vimeo: "https://vimeo.com/api/oembed.json?url=",
  dailymotion: "https://www.dailymotion.com/services/oembed?url=",
  twitter: "https://publish.twitter.com/oembed?omit_script=true&url=",
};

export const linkTitle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ url: z.string().url().max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const p = parseVideoSource(data.url).provider;
    const base = OEMBED[p];
    if (!base) return { title: "" };
    try {
      const r = await fetch(base + encodeURIComponent(data.url.replace(/^http:/i, "https:")), { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return { title: "" };
      const j: any = await r.json();
      let title = typeof j.title === "string" ? j.title : "";
      if (!title && p === "twitter" && typeof j.html === "string") {
        const m = j.html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        const text = (m?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
        title = text ? `${j.author_name ?? "X"}: ${text}` : String(j.author_name ?? "");
      }
      return { title: title.slice(0, 200) };
    } catch { return { title: "" }; }
  });
