// Browser-safe monetization constants (public IDs only — no secrets).
export const ADSENSE_CLIENT = "ca-pub-1332482197214084";
export const AD_SLOTS = {
  watch: { slot: "2818934058", format: "auto" as const },
  feed: { slot: "6430428899", format: "fluid" as const, layoutKey: "-6t+ed+2i-1n-4w" },
  detail: { slot: "7890105364", format: "auto" as const },
  search: { slot: "3314059398", format: "auto" as const },
  home: { slot: "3619687862", format: "auto" as const },
  shorts: { slot: "1617834340", format: "auto" as const },
};

/** Indexes (0-based, within a list of `count` items) after which an in-feed ad goes. Pure; tested. */
export function adPositions(count: number, every: number): number[] {
  if (every < 1) return [];
  const out: number[] = [];
  for (let i = every - 1; i < count - 1; i += every) out.push(i);
  return out;
}

export const AD_UNIT_NAMES = {
  watch: "Watch Below-Player", feed: "In-Feed (posts)", detail: "Title Detail Mid-Page",
  search: "Search Results", home: "Home Rail Divider", shorts: "Shorts Dedicated Vertical",
} as const;
export const AD_KINDS = ["watch", "feed", "detail", "search", "home", "shorts"] as const;
