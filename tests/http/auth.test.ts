import { describe, expect, test } from "bun:test";
import { addUser, Client, loggedIn, ORIGIN, setup } from "../helpers";
import { findUserByUsername } from "../../src/repo/users";

const PW = "correct horse battery";

describe("login page", () => {
  test("renders the form with a CSRF token cookie", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    const res = await c.get("/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("Welcome back");
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain("0 accounts");
    expect(c.cookies.get("tandem_csrf")).toBe(c.csrf);
    // existing cookie is reused
    await c.get("/login");
    expect(c.cookies.get("tandem_csrf")).toBe(c.csrf);
  });
  test("account count is singular for one user", async () => {
    const ctx = setup();
    await addUser(ctx.db, "alice", PW);
    expect(await (await new Client(ctx).get("/login")).text()).toContain("1 account<");
  });
  test("signed-in users are redirected home", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const res = await client.get("/login");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });
  test("protected pages redirect anonymous users to /login, POSTs get 401", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    const res = await c.get("/");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    await c.get("/login");
    expect((await c.post("/lists")).status).toBe(401);
  });
});

describe("login", () => {
  test("success issues a fresh HttpOnly SameSite=Strict session and clears the pre-auth token", async () => {
    const ctx = setup();
    await addUser(ctx.db, "alice", PW);
    const c = new Client(ctx);
    await c.get("/login");
    const res = await c.post("/login", { username: "Alice", password: PW, remember: "on" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const cookies = res.headers.getSetCookie();
    const sid = cookies.find((x) => x.startsWith("tandem_sid="))!;
    expect(sid).toContain("HttpOnly");
    expect(sid).toContain("SameSite=Strict");
    expect(sid).toMatch(/Max-Age=2592000/);
    expect(cookies.some((x) => x.startsWith("tandem_csrf=;"))).toBe(true);
    expect(ctx.logger.entries.some((e) => e.event === "login_success")).toBe(true);
    expect((await c.get("/")).status).toBe(200);
  });
  test("without remember the cookie is a browser-session cookie", async () => {
    const ctx = setup();
    await addUser(ctx.db, "alice", PW);
    const c = new Client(ctx);
    await c.get("/login");
    const res = await c.post("/login", { username: "alice", password: PW });
    expect(res.headers.getSetCookie().find((x) => x.startsWith("tandem_sid="))).not.toContain("Max-Age");
  });
  test("secure mode uses __Host- cookies with Secure flag", async () => {
    const ctx = setup({ cookieSecure: true });
    await addUser(ctx.db, "alice", PW);
    const c = new Client(ctx);
    const page = await c.get("/login");
    expect(page.headers.get("set-cookie")).toMatch(/^__Host-tandem_csrf=.*Secure/);
    const res = await c.post("/login", { username: "alice", password: PW });
    expect(res.headers.getSetCookie().find((x) => x.startsWith("__Host-tandem_sid="))).toContain("Secure");
    expect((await c.get("/")).status).toBe(200);
  });
  test("wrong password and unknown user give the same generic error", async () => {
    const ctx = setup();
    await addUser(ctx.db, "alice", PW);
    const c = new Client(ctx);
    await c.get("/login");
    const a = await c.post("/login", { username: "alice", password: "nope" });
    const b = await c.post("/login", { username: "ghost", password: "nope" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const [ha, hb] = [await a.text(), await b.text()];
    expect(ha).toContain("Incorrect username or password.");
    expect(hb).toContain("Incorrect username or password.");
    expect(ha).toContain('value="alice"'); // username kept, password never echoed
    expect(ha).not.toContain("nope");
    expect(ctx.logger.entries.filter((e) => e.event === "login_failed").map((e) => e.fields.reason)).toEqual([
      "bad_password", "unknown_user",
    ]);
  });
  test("invalid body is a 400 with the generic error", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    await c.get("/login");
    const res = await c.post("/login", { username: "", password: "" });
    expect(res.status).toBe(400);
  });
  test("account lockout after 5 failures (spread over IPs), hidden behind the generic error, expires", async () => {
    const ctx = setup({ trustProxy: true });
    await addUser(ctx.db, "alice", PW);
    const c = new Client(ctx);
    await c.get("/login");
    const from = (ip: string) => ({ headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 5; i++) await c.post("/login", { username: "alice", password: "bad" }, from(`10.0.0.${i}`));
    expect(ctx.logger.entries.some((e) => e.event === "account_locked")).toBe(true);
    const locked = await c.post("/login", { username: "alice", password: PW }, from("10.0.1.1"));
    expect(locked.status).toBe(401);
    expect(await locked.text()).toContain("Incorrect username or password.");
    ctx.clock.t += ctx.config.login.lockoutMs + 1;
    expect((await c.post("/login", { username: "alice", password: PW }, from("10.0.1.1"))).status).toBe(303);
    expect(findUserByUsername(ctx.db, "alice")).toMatchObject({ failed_attempts: 0, locked_until: null });
  });
  test("3 failed attempts block the IP for 2 minutes, even for the right password", async () => {
    const ctx = setup();
    await addUser(ctx.db, "alice", PW);
    const c = new Client(ctx);
    await c.get("/login");
    const first = await c.post("/login", { username: "alice", password: "bad" });
    expect(first.status).toBe(401);
    expect(await first.text()).toContain("2 attempts left before sign-in is paused for 2 minutes.");
    const second = await c.post("/login", { username: "ghost", password: "bad" });
    expect(await second.text()).toContain("1 attempt left before");
    const third = await c.post("/login", { username: "alice", password: "bad" });
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("120");
    const html = await third.text();
    expect(html).toContain("Too many failed sign-in attempts. Try again in 2 minutes.");
    expect(html).toContain('value="alice"');
    expect(ctx.logger.entries.find((e) => e.event === "ip_blocked")?.fields).toMatchObject({ blockMs: 120_000, failures: 3 });

    // blocked: correct password refused without being checked
    ctx.clock.t += 45_000;
    const during = await c.post("/login", { username: "alice", password: PW });
    expect(during.status).toBe(429);
    expect(during.headers.get("retry-after")).toBe("75");
    expect(await during.text()).toContain("Try again in 2 minutes."); // 75 s rounds up
    expect(ctx.logger.entries.some((e) => e.event === "login_blocked_ip")).toBe(true);
    ctx.clock.t += 30_000;
    expect(await (await c.post("/login", { username: "alice", password: PW })).text()).toContain("Try again in 45 seconds.");

    // block over
    ctx.clock.t += 45_000;
    expect((await c.post("/login", { username: "alice", password: PW })).status).toBe(303);
  });
  test("a successful login resets the IP's failure count", async () => {
    const ctx = setup();
    await addUser(ctx.db, "alice", PW);
    const c = new Client(ctx);
    await c.get("/login");
    await c.post("/login", { username: "alice", password: "bad" });
    await c.post("/login", { username: "alice", password: "bad" });
    expect((await c.post("/login", { username: "alice", password: PW })).status).toBe(303);
    const other = new Client(ctx);
    await other.get("/login");
    const res = await other.post("/login", { username: "alice", password: "bad" });
    expect(await res.text()).toContain("2 attempts left");
  });
  test("invalid submissions count as failures", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    await c.get("/login");
    const res = await c.post("/login", { username: "", password: "" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("2 attempts left");
  });
  test("X-Forwarded-For is only trusted behind a proxy", async () => {
    const ctx = setup({ trustProxy: true });
    ctx.config.login.ipMaxFailures = 1;
    const c = new Client(ctx);
    await c.get("/login");
    const h = (ip: string) => ({ headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
    expect((await c.post("/login", { username: "a", password: "b" }, h("1.1.1.1"))).status).toBe(429);
    expect((await c.post("/login", { username: "a", password: "b" }, h("2.2.2.2"))).status).toBe(429);
    expect((await c.post("/login", { username: "a", password: "b" }, h("1.1.1.1"))).status).toBe(429);
    expect(ctx.logger.entries.filter((e) => e.event === "ip_blocked").map((e) => e.fields.ip)).toEqual(["1.1.1.1", "2.2.2.2"]);
    // no header -> falls back to the connection address
    expect((await c.post("/login", { username: "a", password: "b" })).status).toBe(429);
    expect(ctx.logger.entries.filter((e) => e.event === "ip_blocked").at(-1)?.fields.ip).toBe("unknown");
  });
  test("without trustProxy, X-Forwarded-For cannot be used to dodge the block", async () => {
    const ctx = setup();
    ctx.config.login.ipMaxFailures = 1;
    const c = new Client(ctx);
    await c.get("/login");
    await c.post("/login", { username: "a", password: "b" }, { headers: { "x-forwarded-for": "1.1.1.1" } });
    const res = await c.post("/login", { username: "a", password: "b" }, { headers: { "x-forwarded-for": "9.9.9.9" } });
    expect(res.status).toBe(429);
    expect(ctx.logger.entries.at(-1)?.event).toBe("login_blocked_ip");
  });
  test("session fixation: an existing session is replaced on login", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const before = client.cookies.get("tandem_sid");
    const res = await client.post("/login", { username: "alice", password: PW });
    expect(res.status).toBe(303);
    expect(client.cookies.get("tandem_sid")).not.toBe(before);
    expect((ctx.db.query("SELECT COUNT(*) n FROM sessions").get() as any).n).toBe(1);
  });
});

describe("sessions", () => {
  test("logout destroys the server session and clears site data", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const sid = client.cookies.get("tandem_sid")!;
    const res = await client.post("/logout");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("clear-site-data")).toContain("storage");
    expect((ctx.db.query("SELECT COUNT(*) n FROM sessions").get() as any).n).toBe(0);
    // replaying the old cookie does not work
    const replay = await ctx.app.request("/", { headers: { cookie: `tandem_sid=${sid}` } });
    expect(replay.status).toBe(303);
    expect(replay.headers.getSetCookie().some((x) => x.startsWith("tandem_sid=;"))).toBe(true);
  });
  test("logout without a session still redirects", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    await c.get("/login");
    expect((await c.post("/logout")).status).toBe(303);
  });
  test("idle timeout signs the user out", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    ctx.clock.t += ctx.config.session.persistentIdleMs;
    expect((await client.get("/")).status).toBe(303);
  });
  test("a session whose user was deleted is rejected", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    ctx.db.exec("PRAGMA foreign_keys = OFF");
    ctx.db.query("DELETE FROM users WHERE id = ?").run(user.id);
    expect((await client.get("/")).status).toBe(303);
  });
});

describe("theme", () => {
  test("theme cookie switches the rendered theme and redirects safely", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    await c.get("/login");
    const res = await c.post("/theme", { theme: "light", next: "/login" });
    expect(res.headers.get("location")).toBe("/login");
    expect(c.cookies.get("tandem_theme")).toBe("light");
    expect(await (await c.get("/login")).text()).toContain('class="tdm-light"');
    await c.post("/theme", { theme: "anything" });
    expect(c.cookies.get("tandem_theme")).toBe("dark");
    const evil = await c.post("/theme", { theme: "dark", next: "https://evil.test" });
    expect(evil.headers.get("location")).toBe("/");
  });
  test("the toggle offers the opposite theme", async () => {
    const ctx = setup();
    const html = await (await new Client(ctx).get("/login")).text();
    expect(html).toContain('name="theme" value="light"');
    expect(html).toContain('aria-label="Switch to light theme"');
  });
});

describe("origin", () => {
  test("ALLOWED_ORIGINS are accepted for posts", async () => {
    const ctx = setup({ allowedOrigins: ["https://tandem.example"] });
    const c = new Client(ctx, "https://tandem.example");
    await c.get("/login");
    expect((await c.post("/theme", { theme: "light" })).status).toBe(303);
    expect(ORIGIN).toBe("http://localhost");
  });
});

test("theme form is not boosted (the theme class lives on <html>, outside the swapped body)", async () => {
  const html = await (await new Client(setup()).get("/login")).text();
  expect(html).toMatch(/action="\/theme"[^>]*hx-boost="false"/);
});
