import { describe, expect, it } from "vitest";
import { isPublicEligible, publishGate } from "@/lib/owner-content";

describe("public eligibility follows the database state", () => {
  it("published row is public", () => expect(isPublicEligible("PUBLISHED", true)).toBe(true));
  it("rejected row stays hidden even if the body says published", () => expect(isPublicEligible("REJECTED", true)).toBe(false));
  it("draft row stays hidden", () => expect(isPublicEligible("DRAFT", true)).toBe(false));
  it("unpublished body stays hidden", () => expect(isPublicEligible("PUBLISHED", false)).toBe(false));
  it("legacy row without status uses the body flag", () => expect(isPublicEligible(undefined, true)).toBe(true));
  it("missing video file is rejected, not published", () =>
    expect(publishGate(true, { exists: false, mime: null }, null).status).toBe("REJECTED"));
});
