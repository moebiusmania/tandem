import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createList } from "../../src/repo/lists";
import { loggedIn, ORIGIN, setup } from "../helpers";

// A real DOM for the Alpine components; only the globals app.js touches are swapped in.
const win = new Window({ url: `${ORIGIN}/` });
const components: Record<string, () => any> = {};
const saved = { document: globalThis.document, window: globalThis.window, FormData: globalThis.FormData, fetch: globalThis.fetch, location: (globalThis as any).location };

beforeAll(async () => {
  Object.assign(globalThis, { document: win.document, window: win, FormData: win.FormData });
  (win as any).Alpine = { data: (name: string, f: () => any) => (components[name] = f) };
  await import("../../public/js/app.js");
  win.document.dispatchEvent(new win.Event("alpine:init"));
});

afterAll(() => {
  Object.assign(globalThis, saved);
  win.close();
});

const classList = () => {
  const set = new Set<string>();
  return { set, toggle: (c: string) => (set.has(c) ? set.delete(c) : set.add(c)), add: (c: string) => set.add(c) };
};

describe("client components", () => {
  test("registers all components", () => {
    expect(Object.keys(components).sort()).toEqual(["adder", "autosubmit", "confirmer", "item", "menu", "password", "pwchange", "switcher"]);
  });
  test("account menu opens, closes and returns focus", () => {
    let focused = 0;
    const m = components.menu!();
    Object.assign(m, {
      $root: { querySelector: () => ({ focus: () => {} }) },
      $refs: { trigger: { focus: () => focused++ } },
      $nextTick: (f: () => void) => f(),
    });
    expect([m.open, m.expanded]).toEqual([false, "false"]);
    m.close(); // closing a closed menu must not steal focus
    expect(focused).toBe(0);
    m.toggle();
    expect([m.open, m.expanded]).toEqual([true, "true"]);
    m.close();
    expect([m.open, focused]).toEqual([false, 1]);
  });
  test("password toggle", () => {
    const p = components.password!();
    expect([p.type, p.label, p.aria]).toEqual(["password", "Show", "Show password"]);
    p.toggle();
    expect([p.type, p.label, p.aria]).toEqual(["text", "Hide", "Hide password"]);
  });
  test("autosubmit submits the form and selects text", () => {
    const a = components.autosubmit!();
    let submitted = 0, selected = 0;
    a.$el = { form: { requestSubmit: () => submitted++ }, select: () => selected++ };
    a.submit();
    a.select();
    expect([submitted, selected]).toEqual([1, 1]);
    a.$el = {};
    expect(() => (a.submit(), a.select())).not.toThrow();
  });
  test("switcher flips aria-checked", () => {
    const s = components.switcher!();
    const attrs: Record<string, string> = { "aria-checked": "false" };
    const btn = { getAttribute: (k: string) => attrs[k], setAttribute: (k: string, v: string) => (attrs[k] = v) };
    s.$root = { querySelector: () => btn };
    s.flip();
    expect(attrs["aria-checked"]).toBe("true");
    s.flip();
    expect(attrs["aria-checked"]).toBe("false");
    s.$root = { querySelector: () => null };
    expect(() => s.flip()).not.toThrow();
  });
  test("confirmer cancels the submit unless the user confirms", () => {
    const c = components.confirmer!();
    c.$root = { dataset: { confirm: "Delete “L”?" } };
    const asked: string[] = [];
    let answer = false;
    (win as any).confirm = (q: string) => (asked.push(q), answer);
    let prevented = 0;
    const ev = { preventDefault: () => prevented++ };
    c.ask(ev);
    answer = true;
    c.ask(ev);
    expect(asked).toEqual(["Delete “L”?", "Delete “L”?"]);
    expect(prevented).toBe(1);
  });
  test("item optimistic classes", () => {
    const it = components.item!();
    const cl = classList();
    it.$root = { classList: cl };
    it.toggle();
    expect([...cl.set].sort()).toEqual(["is-done", "is-ticking"]);
    it.toggle();
    expect(cl.set.has("is-done")).toBe(false);
    it.remove();
    expect(cl.set.has("is-removing")).toBe(true);
  });
});

/**
 * End-to-end optimistic add: render the real page from the app into the DOM, submit through
 * the adder with `fetch` routed to the app, and apply out-of-band fragments like htmx does.
 */
describe("adder (optimistic add)", () => {
  async function mount(opts: { shared?: boolean } = {}) {
    const ctx = setup();
    const { client, user } = await loggedIn(ctx);
    const list = createList(ctx.db, { ownerId: user.id, name: "Groceries", now: 1 });
    if (opts.shared) ctx.db.query("UPDATE lists SET shared = 1 WHERE id = ?").run(list.id);
    const html = await (await client.get(`/lists/${list.id}`)).text();
    win.document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1]!;

    const requests: { url: string; status: number; sent: URLSearchParams }[] = [];
    let mode: "ok" | "network" | number = "ok";
    let seenDuringFlight: string[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      // Snapshot what the user sees while the request is still in flight.
      seenDuringFlight = [...win.document.querySelectorAll(".items .item")].map((li) => li.id);
      const sent = new URLSearchParams(init.body as URLSearchParams);
      if (mode === "network") throw new TypeError("Failed to fetch");
      if (typeof mode === "number") sent.set("_csrf", "broken");
      const cookie = [...client.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await ctx.app.request(new URL(url).pathname, {
        method: "POST",
        body: sent,
        headers: { ...(init.headers as Record<string, string>), cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      });
      requests.push({ url, status: res.status, sent });
      return res;
    }) as typeof fetch;

    // Minimal htmx.swap: apply hx-swap-oob elements (outerHTML:#sel or same-id replacement).
    (win as any).htmx = {
      swap(_target: unknown, content: string, spec: { swapStyle: string; transition?: boolean }) {
        expect(spec.swapStyle).toBe("none");
        expect(spec.transition).toBe(false); // must run synchronously, before the placeholder is removed
        const tpl = win.document.createElement("template");
        tpl.innerHTML = content;
        for (const el of [...tpl.content.children]) {
          const how = el.getAttribute("hx-swap-oob")!;
          el.removeAttribute("hx-swap-oob");
          const target = how === "true" ? win.document.getElementById(el.id) : win.document.querySelector(how.split(":")[1]!);
          target?.replaceWith(el);
        }
      },
    };

    const form = win.document.querySelector('form[x-data="adder"]') as any;
    const adder = components.adder!();
    adder.$root = form;
    adder.$refs = { error: form.querySelector('[x-ref="error"]') };
    const type = (title: string, due = "") => {
      form.elements.namedItem("title").value = title;
      form.elements.namedItem("due").value = due;
    };
    return { ctx, form, adder, type, requests, setMode: (m: typeof mode) => (mode = m), inFlight: () => seenDuringFlight };
  }

  const titles = () => [...win.document.querySelectorAll(".items .item .item-title")].map((e) => e.textContent);

  test("shows the task before the server answers, then swaps in the real row and counters", async () => {
    const { form, adder, type, requests, inFlight } = await mount({ shared: true });
    expect(win.document.querySelector(".items-empty")).not.toBeNull();
    type("Olive oil", "2026-11-08");
    const done = adder.submit();
    // synchronously: placeholder visible, input cleared and focused
    const pending = win.document.querySelector(".items .item.is-pending")!;
    expect(pending.id).toMatch(/^pending-[a-f0-9]{16}$/);
    expect(pending.querySelector(".item-title")!.textContent).toBe("Olive oil");
    expect(pending.querySelector(".who")!.textContent).toContain("Alice"); // author on shared lists
    expect(form.elements.namedItem("title").value).toBe("");
    expect(form.elements.namedItem("due").value).toBe("");
    expect(win.document.activeElement).toBe(form.elements.namedItem("title"));
    await done;

    expect(inFlight()).toEqual([pending.id]);
    expect(requests[0]!.status).toBe(200);
    expect(requests[0]!.sent.get("cid")).toBe(pending.id.slice("pending-".length));
    expect(win.document.querySelector(".is-pending")).toBeNull();
    const real = win.document.querySelector(".items .item")!;
    expect(real.id).toMatch(/^item-\d+$/);
    expect(real.querySelector(".due")!.textContent).toBe("Today");
    expect(win.document.getElementById("progress")!.textContent).toContain("0 of 1 done");
    expect(win.document.getElementById("tabs")!.textContent).toContain("To do 1");
    expect(win.document.querySelector("#stats .stat-n")!.textContent).toBe("1");
    expect(win.document.querySelector(".row-open")!.textContent).toBe("1 open");
    expect(win.document.querySelector(".ring-n")!.textContent).toBe("1");
    expect(adder.$refs.error.textContent).toBe("");
  });

  test("XSS: the placeholder renders the title as text", async () => {
    const { adder, type } = await mount();
    type('<img src=x onerror="alert(1)">');
    const done = adder.submit();
    expect(win.document.querySelector(".items img")).toBeNull();
    await done;
    expect(win.document.querySelector(".items img")).toBeNull();
    expect(titles()).toEqual(['<img src=x onerror="alert(1)">']);
  });

  test("server rejection rolls back: row removed, text restored, error shown", async () => {
    const { ctx, form, adder, type, requests, setMode } = await mount();
    setMode(403);
    type("Basil", "2026-11-09");
    await adder.submit();
    expect(requests[0]!.status).toBe(403);
    const failed = win.document.querySelector(".items .item")!;
    expect(failed.classList.contains("is-failed")).toBe(true);
    expect(form.elements.namedItem("title").value).toBe("Basil");
    expect(form.elements.namedItem("due").value).toBe("2026-11-09");
    expect(adder.$refs.error.textContent).toContain("Couldn’t add “Basil”");
    await Bun.sleep(350);
    expect(titles()).toEqual([]);
    expect((ctx.db.query("SELECT COUNT(*) n FROM items").get() as any).n).toBe(0);
  });

  test("network failure rolls back but keeps anything typed meanwhile", async () => {
    const { form, adder, type, setMode } = await mount();
    setMode("network");
    type("Bread");
    const done = adder.submit();
    form.elements.namedItem("title").value = "Next thing"; // user keeps typing
    await done;
    expect(form.elements.namedItem("title").value).toBe("Next thing");
    expect(adder.$refs.error.textContent).toContain("Bread");
    await Bun.sleep(350);
    expect(titles()).toEqual([]);
  });

  test("rapid adds each get their own placeholder and all land", async () => {
    const { adder, type, requests } = await mount();
    type("One");
    const a = adder.submit();
    type("Two");
    const b = adder.submit();
    expect(win.document.querySelectorAll(".is-pending")).toHaveLength(2);
    await Promise.all([a, b]);
    expect(requests.map((r) => r.status)).toEqual([200, 200]);
    expect(win.document.querySelectorAll(".is-pending")).toHaveLength(0);
    expect(titles().sort()).toEqual(["One", "Two"]);
  });

  test("blank input does nothing", async () => {
    const { adder, type, requests } = await mount();
    type("   ");
    await adder.submit();
    expect(requests).toHaveLength(0);
    expect(titles()).toEqual([]);
  });

  test("still shows the confirmed row when the template is missing", async () => {
    const { adder, type, requests } = await mount();
    win.document.getElementById("pending-item")!.remove();
    type("Lemons");
    await adder.submit();
    expect(requests[0]!.status).toBe(200);
    expect(titles()).toEqual(["Lemons"]);
  });

  test("with no task list on the page, a failed add still reports the error", async () => {
    const { adder, type, setMode } = await mount();
    win.document.querySelector(".items")!.remove();
    setMode("network");
    type("Lemons");
    await adder.submit();
    expect(adder.$refs.error.textContent).toContain("Lemons");
  });
});

test("with no task list on the page, a successful add does not throw", async () => {
  const ctx = setup();
  const { client, user } = await loggedIn(ctx);
  const list = createList(ctx.db, { ownerId: user.id, name: "L", now: 1 });
  const html = await (await client.get(`/lists/${list.id}`)).text();
  win.document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1]!;
  win.document.querySelector(".items")!.remove();
  globalThis.fetch = (async () => new Response("<p></p>")) as unknown as typeof fetch;
  let swapped = 0;
  (win as any).htmx = { swap: () => swapped++ };
  const form = win.document.querySelector('form[x-data="adder"]') as any;
  const adder = components.adder!();
  adder.$root = form;
  adder.$refs = { error: form.querySelector('[x-ref="error"]') };
  form.elements.namedItem("title").value = "x";
  await adder.submit();
  expect(swapped).toBe(1);
  expect(adder.$refs.error.textContent).toBe("");
});

describe("nav.js: transition direction", () => {
  beforeAll(async () => {
    Object.assign(globalThis, { window: win, document: win.document, location: win.location });
    await import("../../public/js/nav.js");
  });

  /** Fire pagereveal as the browser would after a cross-document navigation; return the types added. */
  function reveal(opts: {
    from?: string;
    to?: string;
    type?: string;
    fromIndex?: number;
    toIndex?: number;
    referrer?: string;
    noNavigationApi?: boolean;
    noTransition?: boolean;
  }): string[] {
    const types = new Set<string>();
    (win as any).navigation = opts.noNavigationApi
      ? undefined
      : {
          activation: {
            navigationType: opts.type ?? "push",
            from: opts.from === undefined ? null : { url: opts.from, index: opts.fromIndex ?? 0 },
            entry: { url: opts.to ?? `${ORIGIN}/`, index: opts.toIndex ?? 1 },
          },
        };
    Object.defineProperty(win.document, "referrer", { value: opts.referrer ?? "", configurable: true });
    const ev = new win.Event("pagereveal");
    Object.defineProperty(ev, "viewTransition", { value: opts.noTransition ? null : { types } });
    win.dispatchEvent(ev);
    return [...types];
  }
  const O = ORIGIN;

  test("opening a list slides forward, going home slides back", () => {
    expect(reveal({ from: `${O}/`, to: `${O}/lists/3` })).toEqual(["forward"]);
    expect(reveal({ from: `${O}/lists/3?tab=done`, to: `${O}/?filter=shared` })).toEqual(["back"]);
  });
  test("switching to another list is forward; same list or same screen has no direction", () => {
    expect(reveal({ from: `${O}/lists/3`, to: `${O}/lists/4` })).toEqual(["forward"]);
    expect(reveal({ from: `${O}/lists/3`, to: `${O}/lists/3?rename=1` })).toEqual([]);
    expect(reveal({ from: `${O}/login`, to: `${O}/` })).toEqual([]);
  });
  test("browser back/forward use the history position", () => {
    expect(reveal({ from: `${O}/lists/4`, to: `${O}/lists/3`, type: "traverse", fromIndex: 5, toIndex: 4 })).toEqual(["back"]);
    expect(reveal({ from: `${O}/`, to: `${O}/lists/3`, type: "traverse", fromIndex: 4, toIndex: 5 })).toEqual(["forward"]);
    // traverse without usable indices falls back to screen depth
    expect(reveal({ from: `${O}/lists/3`, to: `${O}/`, type: "traverse", fromIndex: 2, toIndex: 2 })).toEqual(["back"]);
  });
  test("without the Navigation API the referrer is used", () => {
    win.happyDOM.setURL(`${O}/lists/7`);
    expect(reveal({ noNavigationApi: true, referrer: `${O}/` })).toEqual(["forward"]);
    expect(reveal({ noNavigationApi: true, referrer: "" })).toEqual([]);
    win.happyDOM.setURL(`${O}/`);
  });
  test("ignores cross-origin, malformed URLs and navigations without a transition", () => {
    expect(reveal({ from: "https://elsewhere.test/", to: `${O}/lists/1` })).toEqual([]);
    expect(reveal({ from: "not a url", to: `${O}/lists/1` })).toEqual([]);
    expect(reveal({ from: `${O}/`, to: `${O}/lists/1`, noTransition: true })).toEqual([]);
  });
});

describe("pwchange (change password modal)", () => {
  async function mount() {
    const ctx = setup();
    const { client } = await loggedIn(ctx);
    const html = await (await client.get("/")).text();
    win.document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1]!;
    let calls = 0;
    let mode: "ok" | "network" = "ok";
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls++;
      if (mode === "network") throw new TypeError("Failed to fetch");
      const cookie = [...client.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      return ctx.app.request(new URL(url).pathname, {
        method: "POST",
        body: new URLSearchParams(init.body as URLSearchParams),
        headers: { ...(init.headers as Record<string, string>), cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      });
    }) as typeof fetch;
    const dialog = win.document.getElementById("pw-dialog") as any;
    let closed = 0;
    dialog.close = () => closed++;
    const pw = Object.assign(components.pwchange!(), { $root: dialog });
    const input = dialog.querySelector('input[name="password"]') as HTMLInputElement;
    return { ctx, pw, input, calls: () => calls, closed: () => closed, offline: () => (mode = "network") };
  }

  test("checks the rules locally before calling the server", async () => {
    const { pw, input, calls } = await mount();
    for (const [value, msg] of [
      ["eleven char", "Use at least 12 characters."],
      ["x".repeat(129), "Use at most 128 characters."],
    ]) {
      input.value = value!;
      await pw.submit();
      expect([pw.error, pw.invalid]).toEqual([msg, "true"]);
    }
    expect(calls()).toBe(0);
  });

  test("saves, shows the confirmation and resets on close", async () => {
    const { ctx, pw, input, closed } = await mount();
    input.value = "new pass phrase";
    await pw.submit();
    expect([pw.error, pw.done, pw.editing, pw.busy, input.value]).toEqual(["", true, false, false, ""]);
    const { verifyPassword } = await import("../../src/auth/password");
    const { findUserByUsername } = await import("../../src/repo/users");
    expect(await verifyPassword("new pass phrase", findUserByUsername(ctx.db, "alice")!.password_hash)).toBe(true);
    pw.cancel();
    expect(closed()).toBe(1);
    pw.reset();
    expect([pw.done, pw.error]).toEqual([false, ""]);
  });

  test("reports a network failure", async () => {
    const { pw, input, offline } = await mount();
    offline();
    input.value = "new pass phrase";
    await pw.submit();
    expect(pw.error).toContain("Check your connection");
    expect([pw.done, pw.busy]).toEqual([false, false]);
  });
});
