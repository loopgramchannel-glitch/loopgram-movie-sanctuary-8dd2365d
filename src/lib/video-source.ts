// Smart video link resolver (browser-safe): tells which platform a pasted link is from and how to play it.
export type VideoProvider = "loopgram" | "youtube" | "vimeo" | "dailymotion" | "twitch" | "streamable" | "facebook" | "twitter" | "file" | "unknown";

export type VideoSource = {
  provider: VideoProvider;
  label: string;
  /** Native <video> playback (uploaded or direct file). */
  native: boolean;
  /** iframe player URL for platform links. */
  embed?: string;
  /** Picture we can show before play, when the platform gives one. */
  thumb?: string;
};

export const PROVIDER_LABEL: Record<VideoProvider, string> = {
  loopgram: "Loopgram upload", youtube: "YouTube", vimeo: "Vimeo", dailymotion: "Dailymotion",
  twitch: "Twitch", streamable: "Streamable", facebook: "Facebook", twitter: "X (Twitter)", file: "Direct video", unknown: "Unsupported link",
};

const FILE_RE = /\.(mp4|webm|mov|m4v|m3u8|ogg|ogv)(\?|#|$)/i;

export function parseVideoSource(raw: string, opts: { uploadBase?: string | undefined; parent?: string | undefined } = {}): VideoSource {
  const s = (k: VideoProvider, extra: Partial<VideoSource> = {}): VideoSource => ({ provider: k, label: PROVIDER_LABEL[k], native: false, ...extra });
  let u: URL;
  try { u = new URL(raw.trim().replace(/^http:\/\//i, "https://")); } catch { return s("unknown"); }
  if (u.protocol !== "https:") return s("unknown");
  const host = u.hostname.replace(/^(www\.|m\.)/, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (opts.uploadBase && raw.startsWith(opts.uploadBase)) return s("loopgram", { native: true });

  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    let id = host === "youtu.be" ? parts[0] : u.searchParams.get("v") ?? (["shorts", "embed", "live", "v"].includes(parts[0] ?? "") ? parts[1] : undefined);
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return s("unknown");
    return s("youtube", { embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parts.find((p) => /^\d{6,12}$/.test(p));
    if (!id) return s("unknown");
    return s("vimeo", { embed: `https://player.vimeo.com/video/${id}?dnt=1&title=0&byline=0&portrait=0`, thumb: `https://vumbnail.com/${id}.jpg` });
  }
  if (host === "dailymotion.com" || host === "dai.ly" || host === "geo.dailymotion.com") {
    const id = (host === "dai.ly" ? parts[0]
      : host === "geo.dailymotion.com" ? u.searchParams.get("video") ?? undefined
      : parts[0] === "video" ? parts[1]
      : parts[0] === "embed" ? parts[2]
      : u.searchParams.get("video") ?? undefined)?.split("_")[0];
    if (!id || !/^[A-Za-z0-9]{5,12}$/.test(id)) return s("unknown");
    return s("dailymotion", { embed: `https://geo.dailymotion.com/player.html?video=${id}`, thumb: `https://www.dailymotion.com/thumbnail/video/${id}` });
  }
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com" || host === "mobile.x.com") {
    const i = parts.indexOf("status");
    const id = i >= 0 ? parts[i + 1] : undefined;
    if (!id || !/^\d{5,25}$/.test(id)) return s("unknown");
    return s("twitter", { embed: `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true` });
  }
  if (host === "twitch.tv" || host === "clips.twitch.tv") {
    const parent = opts.parent ?? "localhost";
    if (host === "clips.twitch.tv" && parts[0]) return s("twitch", { embed: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(parts[0])}&parent=${parent}` });
    if (parts[0] === "videos" && /^\d+$/.test(parts[1] ?? "")) return s("twitch", { embed: `https://player.twitch.tv/?video=${parts[1]}&parent=${parent}&autoplay=false` });
    if (parts[1] === "clip" && parts[2]) return s("twitch", { embed: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(parts[2])}&parent=${parent}` });
    if (parts.length === 1 && /^[A-Za-z0-9_]{3,25}$/.test(parts[0]!)) return s("twitch", { embed: `https://player.twitch.tv/?channel=${parts[0]}&parent=${parent}&autoplay=false` });
    return s("unknown");
  }
  if (host === "streamable.com" && parts[0]) {
    const id = parts[0] === "e" ? parts[1] : parts[0];
    if (!id || !/^[a-z0-9]{3,12}$/i.test(id)) return s("unknown");
    return s("streamable", { embed: `https://streamable.com/e/${id}` });
  }
  if (host === "facebook.com" || host === "fb.watch") {
    return s("facebook", { embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(raw)}&show_text=false` });
  }
  if (FILE_RE.test(u.pathname)) return s("file", { native: true });
  return s("unknown");
}

/** Post categories the owner picks from (free text still allowed). */
export const POST_CATEGORIES = ["Gaming", "Music", "Movies & Trailers", "Originals", "Podcasts", "News", "Behind the scenes"] as const;
