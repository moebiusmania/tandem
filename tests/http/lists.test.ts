import { describe, expect, test } from "bun:test";
import { addUser, Client, loggedIn, setup, type TestCtx } from "../helpers";
import { addItem, createList, getAccessibleList, itemsForList, MAX_ITEMS_PER_LIST, MAX_LISTS_PER_USER, setListShared } from "../../src/repo/lists";

async function pair(ctx: TestCtx) {
  const s = await loggedIn(ctx, "alice");
  const g = await loggedIn(ctx, "bob");
  return { s, g };
}

const loc = (r: Response) => r.headers.get("location");

describe("lists", () => {
  test("empty state", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const html = await (await client.get("/")).text();
    expect(html).toContain("No lists yet.");
    expect(html).toContain("No list selected");
    expect(html).not.toContain("November"); // no date on the main screen
    expect(html).toContain("shared with your partner");
  });
  test("create → rename → shows in sidebar", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const res = await client.post("/lists");
    expect(res.status).toBe(303);
    expect(loc(res)).toMatch(/^\/lists\/\d+\?rename=1$/);
    const page = await (await client.get(loc(res)!)).text();
    expect(page).toContain('value="New list"');
    expect(page).toContain("autofocus");
    expect(page).toContain('x-init="select"');
    const id = loc(res)!.match(/\d+/)![0];
    const r2 = await client.post(`/lists/${id}/rename`, { name: "  Groceries  ", next: `/lists/${id}` });
    expect(loc(r2)).toBe(`/lists/${id}`);
    const html = await (await client.get("/")).text();
    expect(html).toContain("Groceries");
    expect(html).toContain("Only you can see this list");
  });
  test("invalid rename is ignored", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "Keep", now: 1 });
    const r = await client.post(`/lists/${l.id}/rename`, { name: "   " });
    expect(loc(r)).toBe(`/lists/${l.id}`);
    expect(getAccessibleList(ctx.db, l.id, user.id)?.name).toBe("Keep");
  });
  test("share toggle and partner wording", async () => {
    const ctx = setup();
    const { s, g } = await pair(ctx);
    const l = createList(ctx.db, { ownerId: s.user.id, name: "Ours", now: 1 });
    let html = await (await s.client.get(`/lists/${l.id}`)).text();
    expect(html).toContain("Share with Bob");
    expect(html).toContain('aria-checked="false"');
    expect((await g.client.get(`/lists/${l.id}`)).status).toBe(404);

    const r = await s.client.post(`/lists/${l.id}/share`, { shared: "1", next: `/lists/${l.id}?tab=done` });
    expect(loc(r)).toBe(`/lists/${l.id}?tab=done`);
    html = await (await s.client.get(`/lists/${l.id}`)).text();
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Bob can see and edit");
    expect(html).toContain("You and Bob");

    const gh = await (await g.client.get(`/lists/${l.id}`)).text();
    expect(gh).toContain("Shared by Alice");
    expect(gh).not.toContain(`/lists/${l.id}/share`); // only the owner controls sharing
    expect(gh).toContain("<h2 class=\"title\">Ours</h2>");

    await s.client.post(`/lists/${l.id}/share`, { shared: "0" });
    expect((await g.client.get(`/lists/${l.id}`)).status).toBe(404);
    expect(ctx.logger.entries.filter((e) => e.event === "list_sharing_changed")).toHaveLength(2);
  });
  test("with several partners the wording is generic", async () => {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    await addUser(ctx.db, "bob", "x".repeat(12));
    await addUser(ctx.db, "marco", "x".repeat(12));
    expect(await (await client.get("/")).text()).toContain("shared with everyone");
  });
  test("delete list (owner only)", async () => {
    const ctx = setup();
    const { s, g } = await pair(ctx);
    const l = createList(ctx.db, { ownerId: s.user.id, name: "Old", now: 1 });
    setListShared(ctx.db, l.id, true);
    expect((await g.client.post(`/lists/${l.id}/delete`)).status).toBe(404);
    const r = await s.client.post(`/lists/${l.id}/delete`);
    expect(loc(r)).toBe("/");
    expect(getAccessibleList(ctx.db, l.id, s.user.id)).toBeNull();
  });
  test("filters", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    createList(ctx.db, { ownerId: user.id, name: "Private one", now: 1 });
    const sh = createList(ctx.db, { ownerId: user.id, name: "Shared one", now: 2 });
    setListShared(ctx.db, sh.id, true);
    const shared = await (await client.get("/?filter=shared")).text();
    expect(shared).toContain("Shared one");
    expect(shared).not.toContain("Private one</span>");
    expect(shared).toContain("<title>Shared one — Tandem</title>"); // first visible list selected
    const priv = await (await client.get("/?filter=private")).text();
    expect(priv).not.toContain("Shared one</span>");
    const bogus = await (await client.get("/?filter=<script>")).text();
    expect(bogus).toContain("Private one");
    expect(bogus).not.toContain("<script>");
    // filter with no matching list
    const ctx2 = setup();
    const { client: c2, user: u2 } = await loggedIn(ctx2);
    createList(ctx2.db, { ownerId: u2.id, name: "Only private", now: 1 });
    const none = await (await c2.get("/?filter=shared")).text();
    expect(none).toContain("No shared lists.");
    expect(none).toContain("<title>Only private — Tandem</title>");
  });
  test("list limit", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    for (let i = 0; i < MAX_LISTS_PER_USER; i++) createList(ctx.db, { ownerId: user.id, name: `L${i}`, now: i });
    expect((await client.post("/lists")).status).toBe(422);
  });
  test("bad and foreign ids are 404", async () => {
    const ctx = setup();
    const { s, g } = await pair(ctx);
    const l = createList(ctx.db, { ownerId: g.user.id, name: "Hers", now: 1 });
    for (const path of ["/lists/abc", "/lists/0", `/lists/${l.id}`, "/lists/9999"]) expect((await s.client.get(path)).status).toBe(404);
    for (const path of [`/lists/${l.id}/rename`, `/lists/${l.id}/share`, `/lists/${l.id}/delete`, `/lists/${l.id}/items`, "/lists/x/items"])
      expect((await s.client.post(path, { name: "pwned", title: "pwned", shared: "1" })).status).toBe(404);
    expect(getAccessibleList(ctx.db, l.id, g.user.id)).toMatchObject({ name: "Hers", shared: 0 });
  });
});

describe("items", () => {
  test("add, toggle, delete with tab-aware redirects", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "Groceries", now: 1 });
    const r = await client.post(`/lists/${l.id}/items`, { title: "Olive oil", due: "2026-11-08", tab: "done", filter: "shared" });
    expect(loc(r)).toMatch(new RegExp(`^/lists/${l.id}\\?filter=shared&added=\\d+$`));
    const r2 = await client.post(`/lists/${l.id}/items`, { title: "Basil", tab: "all" });
    expect(loc(r2)).toMatch(new RegExp(`^/lists/${l.id}\\?tab=all&added=\\d+$`));
    const r3 = await client.post(`/lists/${l.id}/items`, { title: "Bread" });
    expect(loc(r3)).toMatch(new RegExp(`^/lists/${l.id}\\?added=\\d+$`));

    const page = await (await client.get(loc(r)!)).text();
    expect(page).toContain("Olive oil");
    expect(page).toContain('class="due"');
    expect(page).toContain(">Today<");
    expect(page).toContain("item is-new");
    expect(page).toMatch(/id="new-task"[^>]*autofocus/);
    expect(page).toContain("0 of 3 done");
    expect(page).toContain('<span class="stat-n">1</span>');

    const [oil] = itemsForList(ctx.db, l.id).filter((i) => i.title === "Olive oil");
    const t = await client.post(`/items/${oil!.id}/toggle`, { next: `/lists/${l.id}?tab=done` });
    expect(loc(t)).toBe(`/lists/${l.id}?tab=done`);
    const done = await (await client.get(`/lists/${l.id}?tab=done`)).text();
    expect(done).toContain("item is-done");
    expect(done).toContain("1 of 3 done");
    expect(done).toContain("Mark not done: Olive oil");
    expect(done).not.toContain(">Today<"); // done items hide due chip
    expect(done).toContain('aria-current="true">Done 1</a>');

    const all = await (await client.get(`/lists/${l.id}?tab=all`)).text();
    expect(all).toContain("Basil");
    expect(all).toContain("Olive oil");

    const d = await client.post(`/items/${oil!.id}/delete`, { next: "//evil.test" });
    expect(loc(d)).toBe(`/lists/${l.id}`);
    expect(itemsForList(ctx.db, l.id)).toHaveLength(2);
  });
  test("empty-state messages per tab", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
    expect(await (await client.get(`/lists/${l.id}`)).text()).toContain("Empty list. Add the first task above.");
    const it = addItem(ctx.db, { listId: l.id, title: "x", createdBy: user.id, dueDate: null, now: 1 });
    expect(await (await client.get(`/lists/${l.id}?tab=done`)).text()).toContain("Nothing done yet.");
    await client.post(`/items/${it.id}/toggle`);
    expect(await (await client.get(`/lists/${l.id}`)).text()).toContain("All done. Nice work.");
  });
  test("invalid input is ignored, titles are escaped (XSS)", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
    expect(loc(await client.post(`/lists/${l.id}/items`, { title: "   " }))).toBe(`/lists/${l.id}`);
    expect(loc(await client.post(`/lists/${l.id}/items`, { title: "x", due: "nope" }))).toBe(`/lists/${l.id}`);
    expect(itemsForList(ctx.db, l.id)).toHaveLength(0);
    await client.post(`/lists/${l.id}/items`, { title: '<img src=x onerror=alert(1)>"' });
    await client.post(`/lists/${l.id}/rename`, { name: "</title><script>alert(1)</script>" });
    const html = await (await client.get(`/lists/${l.id}`)).text();
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  test("item limit", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
    const ins = ctx.db.prepare("INSERT INTO items (list_id, title, created_by, created_at) VALUES (?, 't', ?, 1)");
    ctx.db.transaction(() => { for (let i = 0; i < MAX_ITEMS_PER_LIST; i++) ins.run(l.id, user.id); })();
    expect((await client.post(`/lists/${l.id}/items`, { title: "one more" })).status).toBe(422);
  });
  test("collaborator can work on items of shared lists, not private ones", async () => {
    const ctx = setup();
    const { s, g } = await pair(ctx);
    const shared = createList(ctx.db, { ownerId: s.user.id, name: "Ours", now: 1 });
    setListShared(ctx.db, shared.id, true);
    const priv = createList(ctx.db, { ownerId: s.user.id, name: "Mine", now: 2 });
    const secret = addItem(ctx.db, { listId: priv.id, title: "secret", createdBy: s.user.id, dueDate: null, now: 1 });

    expect((await g.client.post(`/lists/${shared.id}/items`, { title: "From Bob" })).status).toBe(303);
    const html = await (await s.client.get(`/lists/${shared.id}`)).text();
    expect(html).toContain("From Bob");
    expect(html).toContain('class="who"'); // creator shown on shared lists

    for (const a of ["toggle", "delete"]) expect((await g.client.post(`/items/${secret.id}/${a}`)).status).toBe(404);
    expect((await g.client.post("/items/abc/toggle")).status).toBe(404);
    expect(itemsForList(ctx.db, priv.id)[0]).toMatchObject({ done: 0 });
  });
  test("overdue items are flagged", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
    addItem(ctx.db, { listId: l.id, title: "late", createdBy: user.id, dueDate: "2026-11-01", now: 1 });
    expect(await (await client.get(`/lists/${l.id}`)).text()).toContain("due is-overdue");
  });
});

describe("optimistic add (htmx fragment)", () => {
  const HX = { headers: { "hx-request": "true" } };
  const CID = "0123456789abcdef";

  test("returns the real row replacing the placeholder plus out-of-band counters", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "Groceries", now: 1 });
    setListShared(ctx.db, l.id, true);
    const res = await client.post(`/lists/${l.id}/items`, { title: "Olive oil", due: "2026-11-08", cid: CID, tab: "all" }, HX);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<!doctype");
    const [item] = itemsForList(ctx.db, l.id);
    expect(html).toContain(`id="item-${item!.id}"`);
    expect(html).toContain(`hx-swap-oob="outerHTML:#pending-${CID}"`);
    expect(html).toContain(">Today<");
    expect(html).toContain('class="who"');
    expect(html).toMatch(/id="progress" hx-swap-oob="true"[\s\S]*0 of 1 done/);
    expect(html).toMatch(/id="tabs"[^>]*hx-swap-oob="true"[\s\S]*To do 1/);
    expect(html).toMatch(/id="stats" hx-swap-oob="true"[\s\S]*<span class="stat-n">1<\/span>/);
    expect(html).toContain(`id="row-${l.id}"`);
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("is-new"); // the placeholder already animated in
  });
  test("sidebar row is left out when the current filter hides the list", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "Private", now: 1 });
    const html = await (await client.post(`/lists/${l.id}/items`, { title: "x", cid: CID, filter: "shared" }, HX)).text();
    expect(html).not.toContain(`id="row-${l.id}"`);
    expect(html).toContain(`pending-${CID}`);
  });
  test("failures return error statuses (so the client rolls back) instead of redirects", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
    expect((await client.post(`/lists/${l.id}/items`, { title: "   ", cid: CID }, HX)).status).toBe(422);
    expect((await client.post(`/lists/${l.id}/items`, { title: "x", due: "nope", cid: CID }, HX)).status).toBe(422);
    expect((await client.post("/lists/999/items", { title: "x", cid: CID }, HX)).status).toBe(404);
    expect((await client.post(`/lists/${l.id}/items`, { title: "x", cid: CID }, { ...HX, csrf: "bad" })).status).toBe(403);
    expect(itemsForList(ctx.db, l.id)).toHaveLength(0);
  });
  test("a missing or malformed cid falls back to the redirect flow", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
    for (const cid of [undefined, "x", '"]<script>', "0123456789ABCDEF"]) {
      const res = await client.post(`/lists/${l.id}/items`, { title: "x", ...(cid ? { cid } : {}) }, HX);
      expect(res.status).toBe(303);
    }
    // and without the htmx header a cid is ignored
    expect((await client.post(`/lists/${l.id}/items`, { title: "x", cid: CID })).status).toBe(303);
  });
  test("page wires the optimistic form everywhere except the Done tab", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
    const todo = await (await client.get(`/lists/${l.id}`)).text();
    expect(todo).toContain('x-data="adder"');
    expect(todo).toContain('x-on:submit.prevent="submit"');
    expect(todo).toContain('<template id="pending-item">');
    expect(todo).toContain('x-ref="error"');
    expect(todo).not.toContain('class="who"'); // private list: no author line in the template
    const done = await (await client.get(`/lists/${l.id}?tab=done`)).text();
    expect(done).not.toContain('x-data="adder"');
    expect(done).not.toContain("pending-item");
  });
});

describe("sidebar rows", () => {
  test("progress ring, status and audience wording", async () => {
    const ctx = setup();
    const { s, g } = await pair(ctx);
    const mine = createList(ctx.db, { ownerId: s.user.id, name: "Mine", now: 1 });
    const ours = createList(ctx.db, { ownerId: s.user.id, name: "Ours", now: 2 });
    const hers = createList(ctx.db, { ownerId: g.user.id, name: "Hers", now: 3 });
    setListShared(ctx.db, ours.id, true);
    setListShared(ctx.db, hers.id, true);
    const add = (listId: number, done = false) => {
      const it = addItem(ctx.db, { listId, title: "t", createdBy: s.user.id, dueDate: null, now: 1 });
      if (done) ctx.db.query("UPDATE items SET done = 1 WHERE id = ?").run(it.id);
    };
    add(ours.id, true); add(ours.id); add(ours.id); add(ours.id); // 1 of 4 done
    add(hers.id, true); // all done
    const html = await (await s.client.get(`/lists/${mine.id}`)).text();
    const row = (id: number) => html.match(new RegExp(`<a id="row-${id}"[\\s\\S]*?</a>`))![0];

    expect(row(mine.id)).toContain('class="row-open">Empty<');
    expect(row(mine.id)).toContain('class="row-private">Private<');
    expect(row(mine.id)).not.toContain("ring-fill"); // no arc at 0%
    expect(row(mine.id)).toContain('aria-current="page"');

    expect(row(ours.id)).toContain('class="row-open">3 open<');
    expect(row(ours.id)).toContain('class="row-shared">with Bob<');
    expect(row(ours.id)).toContain('stroke-dasharray="25 100"');
    expect(row(ours.id)).toContain('<span class="ring-n">3</span>');

    expect(row(hers.id)).toContain("is-complete");
    expect(row(hers.id)).toContain('class="row-open">All done<');
    expect(row(hers.id)).toContain('class="row-shared">from Bob<');
    expect(row(hers.id)).toContain('stroke-dasharray="100 100"');
  });
  test("a shared list from an owner who no longer exists", async () => {
    const { rowAudience } = await import("../../src/views/app");
    expect(rowAudience({ shared: 1, owner_id: 99 }, 1, [])).toBe("from someone");
  });
});

describe("icons and PWA", () => {
  test("head links favicon, apple-touch-icon, manifest and theme colour", async () => {
    const ctx = setup();
    const html = await (await new Client(ctx).get("/login")).text();
    for (const s of [
      'rel="icon" href="/favicon.ico"',
      'rel="icon" href="/static/icons/icon.svg"',
      'rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png"',
      'rel="manifest" href="/static/manifest.webmanifest"',
      'name="theme-color" content="#0E0F13"',
    ])
      expect(html).toContain(s);
  });
  test("light theme sets a light theme-color", async () => {
    const ctx = setup();
    const c = new Client(ctx);
    await c.get("/login");
    await c.post("/theme", { theme: "light", next: "/login" });
    expect(await (await c.get("/login")).text()).toContain('name="theme-color" content="#F5F5F0"');
  });
  test("favicon.ico is public, cached and a real ICO", async () => {
    const res = await setup().app.request("/favicon.ico");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0, 0, 1, 0]);
  });
  test("manifest is valid and every icon it lists is served", async () => {
    const ctx = setup();
    const res = await ctx.app.request("/static/manifest.webmanifest");
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    const m = await res.json();
    expect(m).toMatchObject({ name: "Tandem", start_url: "/", display: "standalone" });
    expect(m.icons.some((i: any) => i.purpose === "maskable")).toBe(true);
    for (const icon of m.icons) {
      const r = await ctx.app.request(icon.src);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")!.split(";")[0]).toBe(icon.type);
    }
    expect((await ctx.app.request("/static/icons/apple-touch-icon.png")).status).toBe(200);
  });
});

describe("page transitions markup", () => {
  test("screen changes are real navigations; in-screen actions replace history", async () => {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const l = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
    const html = await (await client.get(`/lists/${l.id}`)).text();
    expect(html).toMatch(/<script src="\/static\/js\/nav.js"><\/script>/); // render-blocking, not deferred
    expect(html).toContain('<body hx-boost="true" hx-replace-url="true">');
    expect(html).toMatch(new RegExp(`id="row-${l.id}" href="[^"]+" hx-boost="false"`));
    expect(html).toMatch(/class="brand" aria-label="Tandem home" hx-boost="false"/);
    expect(html).toMatch(/class="icon-btn back" aria-label="Back to your lists" hx-boost="false"/);
    expect(html).toMatch(/action="\/lists" class="side-foot" hx-boost="false"/);
    expect(html).toMatch(new RegExp(`action="/lists/${l.id}/delete" hx-boost="false" x-data="confirmer" x-on:submit="ask" data-confirm="Delete “L” and all its tasks\\?"`));
    expect(html).not.toContain("hx-confirm");
  });
});
