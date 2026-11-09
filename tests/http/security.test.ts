import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createApp } from "../../src/app";
import { Client, loggedIn, setup } from "../helpers";

describe("security headers", () => {
  test("strict CSP and hardening headers on every page", async () => {
    const ctx = setup();
    const res = await new Client(ctx).get("/login");
    const h = res.headers;
    const csp = h.get("content-security-policy")!;
    for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "form-action 'self'", "base-uri 'none'", "object-src 'none'"])
      expect(csp).toContain(d);
    expect(csp).not.toContain("unsafe");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("same-origin");
    expect(h.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(h.get("permissions-policy")).toContain("camera=()");
    expect(h.get("cache-control")).toBe("no-store");
    expect(h.get("strict-transport-security")).toBeNull();
    expect(h.get("x-powered-by")).toBeNull();
  });
  test("HSTS when enabled", async () => {
    const ctx = setup({ hsts: true });
    expect((await ctx.app.request("/healthz")).headers.get("strict-transport-security")).toContain("max-age=63072000");
  });
  test("healthz", async () => {
    expect(await (await setup().app.request("/healthz")).text()).toBe("ok");
  });
});

describe("CSRF", () => {
  test("cross-origin form posts are rejected by origin check", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const res = await client.post("/lists", {}, { headers: { origin: "https://evil.test" } });
    expect(res.status).toBe(403);
  });
  test("Origin: null without Sec-Fetch-Site (old no-referrer behaviour on plain HTTP) is rejected and logged", async () => {
    const ctx = setup();
    const c = new Client(ctx, "null");
    await c.get("/login");
    expect((await c.post("/login", { username: "a", password: "b" })).status).toBe(403);
    expect(ctx.logger.entries.find((e) => e.event === "origin_rejected")?.fields).toMatchObject({ origin: "null", secFetchSite: "(none)" });
  });
  test("a LAN-IP origin matching the Host is accepted", async () => {
    const ctx = setup();
    await (await import("../helpers")).addUser(ctx.db, "alice", "correct horse battery");
    const lan = "http://192.168.1.62:3000";
    const page = await ctx.app.request(`${lan}/login`);
    const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)![1]!;
    const cookie = page.headers.getSetCookie()[0]!.split(";")[0]!;
    const res = await ctx.app.request(`${lan}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: lan, cookie },
      body: new URLSearchParams({ _csrf: csrf, username: "alice", password: "correct horse battery" }),
    });
    expect(res.status).toBe(303);
  });
  test("downstream errors are not reported as origin rejections", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    ctx.db.close();
    expect((await client.post("/lists")).status).toBe(500);
    expect(ctx.logger.entries.some((e) => e.event === "origin_rejected")).toBe(false);
  });
  test("missing Origin is rejected unless Sec-Fetch-Site is same-origin", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const body = new URLSearchParams({ _csrf: client.csrf });
    const cookie = `tandem_sid=${client.cookies.get("tandem_sid")}`;
    const ct = "application/x-www-form-urlencoded";
    expect((await ctx.app.request("/lists", { method: "POST", body, headers: { "content-type": ct, cookie } })).status).toBe(403);
    expect(
      (await ctx.app.request("/lists", { method: "POST", body, headers: { "content-type": ct, cookie, "sec-fetch-site": "same-origin" } })).status,
    ).toBe(303);
  });
  test("missing or wrong synchronizer token is rejected and logged", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    expect((await client.post("/lists", {}, { csrf: null })).status).toBe(403);
    expect((await client.post("/lists", {}, { csrf: "forged" })).status).toBe(403);
    expect(ctx.logger.entries.filter((e) => e.event === "csrf_rejected")).toHaveLength(2);
  });
  test("token may be sent as X-CSRF-Token header", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    expect((await client.post("/lists", {}, { csrf: null, headers: { "x-csrf-token": client.csrf } })).status).toBe(303);
  });
  test("the pre-login token does not work once signed in (bound to session)", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    await c.get("/login");
    const preAuth = c.csrf;
    const { client } = await loggedIn(ctx, "bob");
    expect((await client.post("/lists", {}, { csrf: preAuth })).status).toBe(403);
  });
  test("login form requires the double-submit token", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    await c.get("/login");
    expect((await c.post("/login", { username: "a", password: "b" }, { csrf: "other" })).status).toBe(403);
    // no cookie at all
    const fresh = new Client(ctx);
    expect((await fresh.post("/login", { username: "a", password: "b" }, { csrf: "x" })).status).toBe(403);
  });
  test("unparseable body counts as missing token", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const res = await ctx.app.request("/lists", {
      method: "POST",
      body: "--x\r\nbroken",
      headers: { "content-type": "multipart/form-data; boundary=x", origin: "http://localhost", cookie: `tandem_sid=${client.cookies.get("tandem_sid")}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("robustness", () => {
  test("oversized bodies are rejected", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const res = await client.post("/lists", { pad: "x".repeat(20_000) });
    expect(res.status).toBe(413);
  });
  test("unknown routes 404 without detail", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const res = await client.get("/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
  test("unhandled errors return a generic 500 and are logged", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    ctx.db.close();
    const res = await client.get("/");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Something went wrong.");
    expect(ctx.logger.entries.some((e) => e.event === "unhandled_error")).toBe(true);
  });
  test("HTTPExceptions keep their response", async () => {
    const ctx = setup();
    const res = await ctx.app.request("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.test" }, body: "a=b" });
    expect(res.status).toBe(403);
  });
});

describe("static assets", () => {
  test("served with cache headers, nosniff, and no traversal", async () => {
    const ctx = setup();
    const css = await ctx.app.request("/static/css/app.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(css.headers.get("cache-control")).toBe("public, max-age=3600");
    const js = await ctx.app.request("/static/vendor/htmx.min.js");
    expect(js.status).toBe(200);
    for (const path of ["/static/../package.json", "/static/%2e%2e/package.json", "/static/..%2fpackage.json"]) {
      const res = await ctx.app.request(path);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain('"dependencies"');
    }
    const missing = await ctx.app.request("/static/nope.css");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).not.toBe("public, max-age=3600");
  });
  test("custom static root", async () => {
    const ctx = setup();
    const app = createApp(ctx.deps, { staticRoot: "./tests" });
    expect((await app.request("/static/helpers.ts")).status).toBe(200);
    expect(app).toBeInstanceOf(Hono);
  });
});
