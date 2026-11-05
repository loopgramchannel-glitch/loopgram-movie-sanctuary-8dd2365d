import { describe, expect, it } from "vitest";
import { adPositions, AD_SLOTS } from "@/lib/ads";
import { SiteSettings } from "@/lib/studio.functions";

describe("ad unit slots", () => {
  // The six live placements; a missing key breaks the page that mounts it.
  it("has every placement wired", () => {
    expect(Object.keys(AD_SLOTS).sort()).toEqual(["detail", "feed", "home", "search", "shorts", "watch"]);
  });
});

describe("in-feed ad spacing", () => {
  it("puts an ad after every 8th post", () => expect(adPositions(20, 8)).toEqual([7, 15]));
  it("never puts an ad after the last post", () => expect(adPositions(8, 8)).toEqual([]));
});

describe("monetization defaults", () => {
  it("ads on, both units on, every 8 posts", () => {
    const s = SiteSettings.parse({});
    expect([s.adsOn, s.adWatchOn, s.adFeedOn, s.adFeedEvery]).toEqual([true, true, true, 8]);
  });
  it("old saved premium/movie settings are dropped on read", () => {
    const s = SiteSettings.parse({ banner: "hi", premiumOn: true, tmdbEnabled: true }) as Record<string, unknown>;
    expect(s["banner"]).toBe("hi");
    expect("premiumOn" in s || "tmdbEnabled" in s).toBe(false);
  });
});

describe("dedicated ad units", () => {
  it("search, home and shorts use their own slots", () =>
    expect([AD_SLOTS.search.slot, AD_SLOTS.home.slot, AD_SLOTS.shorts.slot]).toEqual(["3314059398", "3619687862", "1617834340"]));
  it("every unit is on by default", () => expect(SiteSettings.parse({}).adUnitsOff).toEqual([]));
});
