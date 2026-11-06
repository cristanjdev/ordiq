import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "./middleware";

const ORIGIN = "http://192.168.56.1:3000";

function pageRequest(path: string, token?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: token ? { cookie: `ordiq_session=${token}` } : {},
  });
}

function sessionResponse(status: number, code?: string): Response {
  return status === 200
    ? Response.json({ user: { role: "DEAN" } }, { status })
    : Response.json({ error: { code, message: "nope" } }, { status });
}

const isPassThrough = (res: Response) =>
  res.headers.get("x-middleware-next") === "1";

describe("route guard (middleware)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends visitors without a session cookie to /login without calling the API", async () => {
    const res = await middleware(pageRequest("/faculty"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/login?next=%2Ffaculty`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("protects the dashboard root and preserves the query string (minus _rsc)", async () => {
    const root = await middleware(pageRequest("/"));
    expect(root.headers.get("location")).toBe(
      `${ORIGIN}/login`,
    );

    const nav = await middleware(pageRequest("/schedules?view=grid&_rsc=abc12"));
    expect(nav.headers.get("location")).toBe(
      `${ORIGIN}/login?next=%2Fschedules%3Fview%3Dgrid`,
    );
  });

  it("keeps /login reachable for anonymous visitors, uncached", async () => {
    const res = await middleware(pageRequest("/login?reason=expired"));
    expect(isPassThrough(res)).toBe(true);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("lets a valid session through using a passive (non-extending) check", async () => {
    fetchMock.mockResolvedValue(sessionResponse(200));
    const res = await middleware(pageRequest("/rooms", "tok_valid"));

    expect(isPassThrough(res)).toBe(true);
    expect(res.headers.get("cache-control")).toContain("no-store");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("Expected the session endpoint to be called");
    const [url, init] = call;
    expect(String(url)).toBe(`${ORIGIN}/api/v1/auth/session?passive=1`);
    expect((init?.headers as Record<string, string>).cookie).toBe(
      "ordiq_session=tok_valid",
    );
    expect(init?.cache).toBe("no-store");
  });

  it("redirects an expired session with an 'expired' notice and clears the cookie", async () => {
    fetchMock.mockResolvedValue(sessionResponse(401, "SESSION_EXPIRED"));
    const res = await middleware(pageRequest("/reports", "tok_old"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/login?reason=expired&next=%2Freports`,
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ordiq_session=;");
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=thu, 01 jan 1970/);
  });

  it("treats unknown tokens and pending-MFA sessions as 'sign in required'", async () => {
    fetchMock.mockResolvedValueOnce(sessionResponse(401, "UNAUTHORIZED"));
    const unknown = await middleware(pageRequest("/faculty", "tok_x"));
    expect(unknown.headers.get("location")).toBe(
      `${ORIGIN}/login?next=%2Ffaculty`,
    );

    fetchMock.mockResolvedValueOnce(sessionResponse(401, "TOTP_REQUIRED"));
    const pending = await middleware(pageRequest("/faculty", "tok_y"));
    expect(pending.headers.get("location")).toBe(
      `${ORIGIN}/login?next=%2Ffaculty`,
    );
  });

  it("fails closed with 503 when the auth backend is down or errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const down = await middleware(pageRequest("/faculty", "tok_z"));
    expect(down.status).toBe(503);
    expect(down.headers.get("retry-after")).toBe("5");

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const broken = await middleware(pageRequest("/faculty", "tok_z"));
    expect(broken.status).toBe(503);
  });

  it("sends an already signed-in user from /login straight into the app", async () => {
    fetchMock.mockResolvedValue(sessionResponse(200));

    const plain = await middleware(pageRequest("/login", "tok_valid"));
    expect(plain.status).toBe(307);
    expect(plain.headers.get("location")).toBe(`${ORIGIN}/`);

    const withNext = await middleware(
      pageRequest("/login?next=%2Fschedules", "tok_valid"),
    );
    expect(withNext.headers.get("location")).toBe(`${ORIGIN}/schedules`);
  });

  it("cannot be abused as an open redirect through ?next=", async () => {
    fetchMock.mockResolvedValue(sessionResponse(200));
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/login",
    ]) {
      const res = await middleware(
        pageRequest(`/login?next=${encodeURIComponent(next)}`, "tok_valid"),
      );
      expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    }
  });

  it("never loops: a stale cookie still reaches the /login form", async () => {
    fetchMock.mockResolvedValue(sessionResponse(401, "SESSION_EXPIRED"));
    const stale = await middleware(pageRequest("/login?reason=expired", "tok_old"));
    expect(isPassThrough(stale)).toBe(true);

    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const offline = await middleware(pageRequest("/login", "tok_old"));
    expect(isPassThrough(offline)).toBe(true);
  });

  it("honors AUTH_INTERNAL_ORIGIN for the validation call", async () => {
    vi.stubEnv("AUTH_INTERNAL_ORIGIN", "http://127.0.0.1:3000");
    fetchMock.mockResolvedValue(sessionResponse(200));
    await middleware(pageRequest("/faculty", "tok_valid"));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:3000/api/v1/auth/session?passive=1",
    );
    vi.unstubAllEnvs();
  });
});

describe("route guard matcher", () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`);

  it("guards pages but skips API routes, Next internals, and public assets", () => {
    for (const guarded of ["/", "/faculty", "/schedules", "/login", "/rooms/x"]) {
      expect(pattern.test(guarded)).toBe(true);
    }
    for (const skipped of [
      "/api/v1/faculty",
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/favicon.ico",
      "/ordiq-icon-white.png",
      "/mseuf-logo.png",
    ]) {
      expect(pattern.test(skipped)).toBe(false);
    }
  });
});
