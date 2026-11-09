import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../context";
import { isoDate } from "../lib/dates";
import {
  FILTERS,
  TABS,
  idSchema,
  listNameSchema,
  newItemSchema,
  pick,
  safeRedirect,
  type Filter,
  type Tab,
} from "../lib/validation";
import {
  MAX_ITEMS_PER_LIST,
  MAX_LISTS_PER_USER,
  addItem,
  countItems,
  countOwnedLists,
  createList,
  deleteItem,
  deleteList,
  dueTodayCount,
  getAccessibleItem,
  getAccessibleList,
  itemsForList,
  listsForUser,
  renameList,
  setListShared,
  toggleItem,
  type List,
} from "../repo/lists";
import { listUsers, type User } from "../repo/users";
import { AddedFragment, AppPage, listHref } from "../views/app";
import { render } from "../views/render";

const notFound = (c: Context<AppEnv>) => c.text("Not found", 404);

/** Client-generated id of an optimistic placeholder row; strictly hex so it is safe in a CSS selector. */
const CID = /^[a-f0-9]{16}$/;

async function form(c: Context<AppEnv>): Promise<Record<string, string>> {
  const body = await c.req.parseBody();
  return Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === "string")) as Record<string, string>;
}

function nextFrom(body: Record<string, string>, fallback: string): string {
  return safeRedirect(body.next, fallback);
}

/** Resolve `:id` to a list the current user may access, or null. */
function accessibleList(c: Context<AppEnv>, raw: string): List | null {
  const id = idSchema.safeParse(raw);
  if (!id.success) return null;
  return getAccessibleList(c.get("deps").db, id.data, c.get("user")!.id);
}

/** Like `accessibleList`, but only the owner may manage the list itself. */
function ownedList(c: Context<AppEnv>, raw: string): List | null {
  const list = accessibleList(c, raw);
  return list && list.owner_id === c.get("user")!.id ? list : null;
}

async function renderApp(
  c: Context<AppEnv>,
  opts: { selectedId: number | null; view: "lists" | "detail"; addedId?: number; renaming?: boolean },
) {
  const { db, now } = c.get("deps");
  const user = c.get("user") as User;
  const filter: Filter = pick(FILTERS, c.req.query("filter"), "all");
  const tab: Tab = pick(TABS, c.req.query("tab"), "todo");
  const today = new Date(now());
  const lists = listsForUser(db, user.id);

  let selected: List | null = null;
  if (opts.selectedId !== null) {
    selected = getAccessibleList(db, opts.selectedId, user.id);
    if (!selected) return notFound(c);
  } else {
    const first =
      lists.find((l) => filter === "all" || (filter === "shared" ? l.shared : !l.shared)) ?? lists[0] ?? null;
    selected = first;
  }

  const everyone = listUsers(db);
  return render(
    c,
    <AppPage
      me={everyone.find((u) => u.id === user.id)!}
      others={everyone.filter((u) => u.id !== user.id)}
      lists={lists}
      filter={filter}
      selected={selected}
      items={selected ? itemsForList(db, selected.id) : []}
      tab={tab}
      view={opts.view}
      today={today}
      dueToday={dueTodayCount(db, user.id, isoDate(today))}
      csrf={c.get("csrf")}
      theme={c.get("theme")}
      addedId={opts.addedId}
      renaming={opts.renaming}
      path={opts.view === "detail" && selected ? listHref(selected.id, filter, tab) : listHref(null, filter, tab)}
    />,
  );
}

export function listRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => renderApp(c, { selectedId: null, view: "lists" }));

  r.get("/lists/:id", async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    if (!id.success) return notFound(c);
    const added = idSchema.safeParse(c.req.query("added"));
    return renderApp(c, {
      selectedId: id.data,
      view: "detail",
      addedId: added.success ? added.data : undefined,
      renaming: c.req.query("rename") === "1",
    });
  });

  r.post("/lists", async (c) => {
    const { db, now, logger } = c.get("deps");
    const user = c.get("user")!;
    if (countOwnedLists(db, user.id) >= MAX_LISTS_PER_USER) return c.text("List limit reached", 422);
    const list = createList(db, { ownerId: user.id, name: "New list", now: now() });
    logger.log("info", "list_created", { userId: user.id, listId: list.id });
    return c.redirect(`/lists/${list.id}?rename=1`, 303);
  });

  r.post("/lists/:id/rename", async (c) => {
    const list = ownedList(c, c.req.param("id"));
    if (!list) return notFound(c);
    const body = await form(c);
    const parsed = listNameSchema.safeParse(body);
    if (parsed.success) renameList(c.get("deps").db, list.id, parsed.data.name);
    return c.redirect(nextFrom(body, `/lists/${list.id}`), 303);
  });

  r.post("/lists/:id/share", async (c) => {
    const list = ownedList(c, c.req.param("id"));
    if (!list) return notFound(c);
    const body = await form(c);
    const shared = body.shared === "1";
    setListShared(c.get("deps").db, list.id, shared);
    c.get("deps").logger.log("info", "list_sharing_changed", { userId: c.get("user")!.id, listId: list.id, shared });
    return c.redirect(nextFrom(body, `/lists/${list.id}`), 303);
  });

  r.post("/lists/:id/delete", async (c) => {
    const list = ownedList(c, c.req.param("id"));
    if (!list) return notFound(c);
    deleteList(c.get("deps").db, list.id);
    c.get("deps").logger.log("info", "list_deleted", { userId: c.get("user")!.id, listId: list.id });
    return c.redirect("/", 303);
  });

  r.post("/lists/:id/items", async (c) => {
    const { db, now } = c.get("deps");
    const list = accessibleList(c, c.req.param("id"));
    if (!list) return notFound(c);
    const body = await form(c);
    const filter = pick(FILTERS, body.filter, "all");
    const tab = pick(TABS, body.tab, "todo");
    const back = listHref(list.id, filter, tab === "done" ? "todo" : tab);
    // Optimistic add from the client: answer with fragments, and with an error status on any
    // failure so the placeholder is rolled back. Plain form posts keep the redirect flow.
    const cid = c.req.header("hx-request") === "true" && CID.test(body.cid ?? "") ? body.cid! : null;
    const parsed = newItemSchema.safeParse(body);
    if (!parsed.success) return cid ? c.text("Invalid task", 422) : c.redirect(back, 303);
    if (countItems(db, list.id) >= MAX_ITEMS_PER_LIST) return c.text("Task limit reached", 422);
    const user = c.get("user")!;
    const item = addItem(db, {
      listId: list.id,
      title: parsed.data.title,
      dueDate: parsed.data.due,
      createdBy: user.id,
      now: now(),
    });
    if (!cid) return c.redirect(`${back}${back.includes("?") ? "&" : "?"}added=${item.id}`, 303);

    const today = new Date(now());
    const lists = listsForUser(db, user.id);
    const everyone = listUsers(db);
    const fragment = (
      <AddedFragment
        cid={cid}
        item={itemsForList(db, list.id).find((i) => i.id === item.id)!}
        list={lists.find((l) => l.id === list.id)!}
        me={everyone.find((u) => u.id === user.id)!}
        others={everyone.filter((u) => u.id !== user.id)}
        filter={filter}
        tab={tab}
        today={today}
        dueToday={dueTodayCount(db, user.id, isoDate(today))}
        sharedCount={lists.filter((l) => l.shared).length}
        csrf={c.get("csrf")}
      />
    );
    return c.html(await fragment.toString());
  });

  const itemAction = (fn: (c: Context<AppEnv>, itemId: number) => void) => async (c: Context<AppEnv>) => {
    const id = idSchema.safeParse(c.req.param("id"));
    const item = id.success ? getAccessibleItem(c.get("deps").db, id.data, c.get("user")!.id) : null;
    if (!item) return notFound(c);
    const body = await form(c);
    fn(c, item.id);
    return c.redirect(nextFrom(body, `/lists/${item.list_id}`), 303);
  };

  r.post("/items/:id/toggle", itemAction((c, id) => toggleItem(c.get("deps").db, id, c.get("deps").now())));
  r.post("/items/:id/delete", itemAction((c, id) => deleteItem(c.get("deps").db, id)));

  return r;
}
