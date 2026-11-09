import { describe, expect, test } from "bun:test";
import { Client, loggedIn, setup } from "../helpers";
import { verifyPassword } from "../../src/auth/password";
import { findUserByUsername } from "../../src/repo/users";

const HX = { headers: { "HX-Request": "true" } };
const sessions = (ctx: ReturnType<typeof setup>) => (ctx.db.query("SELECT COUNT(*) n FROM sessions").get() as any).n;

describe("change password", () => {
  test("the app page offers the dialog", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const html = await (await client.get("/")).text();
    expect(html).toContain('id="pw-dialog"');
    expect(html).toContain('action="/account/password"');
    expect(html).toContain('autocomplete="new-password"');
  });

  test("sets the new password, keeps this session and signs out other devices", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const other = new Client(ctx);
    await other.login("alice", "correct horse battery");
    expect(sessions(ctx)).toBe(2);

    const res = await client.post("/account/password", { password: "new pass phrase" }, HX);
    expect(res.status).toBe(204);

    const user = findUserByUsername(ctx.db, "alice")!;
    expect(await verifyPassword("new pass phrase", user.password_hash)).toBe(true);
    expect(sessions(ctx)).toBe(1);
    expect((await client.get("/")).status).toBe(200); // still signed in, same CSRF token works
    expect((await other.get("/")).status).toBe(303); // other device bounced to login
    expect(ctx.logger.entries.some((e) => e.event === "password_changed" && e.fields.revokedSessions === 1)).toBe(true);

    const fresh = new Client(ctx);
    expect((await fresh.login("alice", "new pass phrase")).status).toBe(303);
  });

  test.each([
    ["", "Use at least 12 characters."],
    ["elevenchars", "Use at least 12 characters."],
    ["x".repeat(129), "Use at most 128 characters."],
  ])("rejects %p", async (password, message) => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const before = findUserByUsername(ctx.db, "alice")!.password_hash;
    const res = await client.post("/account/password", { password }, HX);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(message);
    expect(findUserByUsername(ctx.db, "alice")!.password_hash).toBe(before);
  });

  test("same policy as the CLI: length only, no composition rules", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    expect((await client.post("/account/password", { password: "twelve chars" }, HX)).status).toBe(204);
    expect((await client.post("/account/password", { password: "x".repeat(128) }, HX)).status).toBe(204);
  });

  test("the form renders the shared limits", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const html = await (await client.get("/")).text();
    expect(html).toContain('minlength="12"');
    expect(html).toContain('maxlength="128"');
  });

  test("without htmx it redirects home", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const res = await client.post("/account/password", { password: "new pass phrase" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  test("requires a session and a CSRF token", async () => {
    const ctx = setup();
    const anon = new Client(ctx);
    await anon.get("/login");
    expect((await anon.post("/account/password", { password: "new pass phrase" }, HX)).status).toBe(401);

    const { client } = await loggedIn(ctx);
    expect((await client.post("/account/password", { password: "new pass phrase" }, { csrf: null, ...HX })).status).toBe(403);
  });
});
