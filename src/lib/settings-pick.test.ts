import { describe, expect, it } from "vitest";
import { pickSettingsRaw } from "./settings-pick";

const s = (v: object) => JSON.stringify(v);

describe("pickSettingsRaw", () => {
  it("uses D1 when Redis is down or over quota", () => {
    expect(pickSettingsRaw(null, s({ autoImport: false, _savedAt: 5 }))).toBe(s({ autoImport: false, _savedAt: 5 }));
  });
  it("newer D1 save beats an older Redis copy", () => {
    expect(JSON.parse(pickSettingsRaw(s({ autoImport: true }), s({ autoImport: false, _savedAt: 9 }))!).autoImport).toBe(false);
  });
  it("newer Redis copy wins over older D1 copy", () => {
    expect(JSON.parse(pickSettingsRaw(s({ autoQueue: false, _savedAt: 10 }), s({ autoQueue: true, _savedAt: 3 }))!).autoQueue).toBe(false);
  });
  it("returns null when both stores have nothing", () => {
    expect(pickSettingsRaw(null, null)).toBeNull();
  });
});
