import { describe, expect, it } from "vitest";
import { authErrorMessage, backoffMs, destinationFor, roleFromVerified, validateCredentials } from "@/lib/auth";
import { verifyIdToken, requireOwner } from "@/lib/auth.server";

describe("role-based redirect after login", () => {
  it("sends the owner to /studio", () => expect(destinationFor("owner")).toBe("/studio"));
  it("sends normal users to the homepage", () => expect(destinationFor("user")).toBe("/"));
  it("keeps a safe internal return path for users", () => expect(destinationFor("user", "/post/abc-123")).toBe("/post/abc-123"));
  it("never sends a normal user into Studio", () => expect(destinationFor("user", "/studio")).toBe("/"));
  it("blocks open redirects", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/javascript:x"]) expect(destinationFor("user", bad)).toBe("/");
    expect(destinationFor("owner", "//evil.com")).toBe("/studio");
  });
});

describe("owner role comes only from verified data", () => {
  it("configured owner uid is owner", () => expect(roleFromVerified("OWNER1", {}, "OWNER1")).toBe("owner"));
  it("verified owner custom claim is owner", () => expect(roleFromVerified("x", { role: "owner" }, "OWNER1")).toBe("owner"));
  it("anyone else is a user", () => expect(roleFromVerified("x", { role: "admin" }, "OWNER1")).toBe("user"));
  it("missing owner config never makes everyone owner", () => expect(roleFromVerified("x", {}, undefined)).toBe("user"));
});

describe("server rejects unverified sessions", () => {
  process.env["FIREBASE_PROJECT_ID"] ||= "loopgram-11f99";
  it("rejects missing tokens with 401", async () => { await expect(verifyIdToken(undefined)).rejects.toMatchObject({ status: 401 }); });
  it("rejects a forged token claiming role owner", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = `${b64({ alg: "RS256", kid: "fake" })}.${b64({ sub: "OWNER1", role: "owner", aud: "loopgram-11f99", iss: "https://securetoken.google.com/loopgram-11f99", exp: 9e9 })}.c2ln`;
    await expect(requireOwner(forged)).rejects.toMatchObject({ status: 401 });
  });
});

describe("login form rules", () => {
  it("rejects bad emails", () => expect(validateCredentials("nope", "secret12")).toMatch(/valid email/));
  it("rejects short passwords", () => expect(validateCredentials("a@b.co", "123")).toMatch(/6 characters/));
  it("wrong password and unknown email show the same message", () => expect(authErrorMessage("auth/wrong-password")).toBe(authErrorMessage("auth/user-not-found")));
  it("backs off after 3 failures, capped at 30s", () => { expect(backoffMs(2)).toBe(0); expect(backoffMs(3)).toBe(1000); expect(backoffMs(20)).toBe(30000); });
});
