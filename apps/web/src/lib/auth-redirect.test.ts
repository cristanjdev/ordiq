import { describe, expect, it } from "vitest";
import {
  buildLoginUrl,
  parseLoginNotice,
  sanitizeNextPath,
} from "./auth-redirect";

describe("sanitizeNextPath", () => {
  it("accepts in-app relative paths including query strings", () => {
    expect(sanitizeNextPath("/faculty")).toBe("/faculty");
    expect(sanitizeNextPath("/schedules?view=grid&term=AY2026")).toBe(
      "/schedules?view=grid&term=AY2026",
    );
    expect(sanitizeNextPath("/reports#summary")).toBe("/reports#summary");
  });

  it("falls back for empty or missing values", () => {
    expect(sanitizeNextPath(undefined)).toBe("/");
    expect(sanitizeNextPath(null)).toBe("/");
    expect(sanitizeNextPath("   ")).toBe("/");
    expect(sanitizeNextPath("", "/rooms")).toBe("/rooms");
  });

  it("rejects open-redirect attempts", () => {
    const attacks = [
      "https://evil.example/phish",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example/path",
      "/%2F%2Fevil.example",
      "/%5Cevil.example",
      "/ok\r\nSet-Cookie: x=1",
      "/ok\u0000",
    ];
    for (const attack of attacks) {
      expect(sanitizeNextPath(attack)).toBe("/");
    }
  });

  it("never redirects back into the sign-in screen, API, or Next internals", () => {
    expect(sanitizeNextPath("/login")).toBe("/");
    expect(sanitizeNextPath("/login?next=/faculty")).toBe("/");
    expect(sanitizeNextPath("/login/anything")).toBe("/");
    expect(sanitizeNextPath("/api/v1/faculty")).toBe("/");
    expect(sanitizeNextPath("/_next/static/chunk.js")).toBe("/");
  });

  it("rejects malformed encodings and oversized values", () => {
    expect(sanitizeNextPath("/%E0%A4%A")).toBe("/");
    expect(sanitizeNextPath(`/${"a".repeat(600)}`)).toBe("/");
  });
});

describe("buildLoginUrl", () => {
  it("returns bare /login when there is nothing to carry", () => {
    expect(buildLoginUrl({})).toBe("/login");
    expect(buildLoginUrl({ next: "/" })).toBe("/login");
  });

  it("carries the reason and a sanitized destination", () => {
    expect(buildLoginUrl({ next: "/faculty", reason: "expired" })).toBe(
      "/login?reason=expired&next=%2Ffaculty",
    );
    expect(buildLoginUrl({ reason: "signed_out" })).toBe(
      "/login?reason=signed_out",
    );
    // "required" is omitted for clean production URLs
    expect(buildLoginUrl({ next: "/faculty", reason: "required" })).toBe(
      "/login?next=%2Ffaculty",
    );
  });

  it("drops an unsafe destination instead of forwarding it", () => {
    expect(buildLoginUrl({ next: "//evil.example", reason: "expired" })).toBe(
      "/login?reason=expired",
    );
  });
});

describe("parseLoginNotice", () => {
  it("only accepts known reasons", () => {
    expect(parseLoginNotice("expired")).toBe("expired");
    expect(parseLoginNotice("signed_out")).toBe("signed_out");
    expect(parseLoginNotice("required")).toBe("required");
    expect(parseLoginNotice("<script>")).toBeNull();
    expect(parseLoginNotice(undefined)).toBeNull();
  });
});
