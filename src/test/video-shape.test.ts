import { describe, expect, it } from "vitest";
import { describeShape } from "@/components/VideoInspector";

describe("describeShape", () => {
  it("phone video is vertical 9:16", () => expect(describeShape(1080, 1920)).toMatchObject({ ratio: "9:16", kind: "tall" }));
  it("widescreen is 16:9", () => expect(describeShape(1920, 1080)).toMatchObject({ ratio: "16:9", kind: "wide" }));
  it("square is 1:1", () => expect(describeShape(1080, 1080).ratio).toBe("1:1"));
});
