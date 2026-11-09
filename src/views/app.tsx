import type { FC } from "hono/jsx";
import { dueLabel } from "../lib/dates";
import { PASSWORD_MAX, PASSWORD_MIN, type Filter, type Tab } from "../lib/validation";
import type { ItemView, List, ListSummary } from "../repo/lists";
import { AVATAR_COLORS, initials, type PublicUser } from "../repo/users";
import { CheckIcon, ChevronLeft, ChevronRight, KeyIcon, LockIcon, Logo, LogoutIcon, PlusIcon, TrashIcon, XIcon } from "./icons";
import { CsrfField, Layout, ThemeToggle } from "./layout";

export interface AppProps {
  me: PublicUser;
  others: PublicUser[];
  lists: ListSummary[];
  filter: Filter;
  selected: List | null;
  items: ItemView[];
  tab: Tab;
  view: "lists" | "detail";
  today: Date;
  dueToday: number;
  csrf: string;
  theme: "dark" | "light";
  /** Item just added: gets an entrance animation and keeps focus in the add field. */
  addedId?: number;
  /** Freshly created list: focus its title for renaming. */
  renaming?: boolean;
  path: string;
}

export function listHref(id: number | null, filter: Filter, tab: Tab): string {
  const q = new URLSearchParams();
  if (filter !== "all") q.set("filter", filter);
  if (tab !== "todo") q.set("tab", tab);
  const qs = q.toString();
  return (id === null ? "/" : `/lists/${id}`) + (qs ? `?${qs}` : "");
}

/** "Bob" when there is exactly one other person, otherwise a generic label. */
export function partnerLabel(others: PublicUser[]): string {
  if (others.length === 1) return others[0]!.display_name;
  return others.length === 0 ? "your partner" : "everyone";
}

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

const Avatar: FC<{ user: Pick<PublicUser, "display_name" | "avatar_color">; size: "xs" | "sm" | "md" }> = ({
  user,
  size,
}) => (
  <span class={`avatar avatar-${size} av-${avatarIndex(user.avatar_color)}`} aria-hidden="true">
    {initials(user.display_name)}
  </span>
);

export const avatarIndex = (color: string) => Math.max(0, (AVATAR_COLORS as readonly string[]).indexOf(color));

/** `hx-swap-oob` attribute when a component is sent as an out-of-band update. */
const oob = (value: string | undefined) => (value ? { "hx-swap-oob": value } : {});

export const matchesFilter = (l: Pick<List, "shared">, filter: Filter) =>
  filter === "all" || (filter === "shared" ? !!l.shared : !l.shared);

export const Stats: FC<{ dueToday: number; sharedCount: number; others: PublicUser[]; oob?: boolean }> = (p) => (
  <div class="stats" id="stats" {...oob(p.oob ? "true" : undefined)}>
    <div class="stat stat-due">
      <span class="stat-n">{p.dueToday}</span>
      <span class="stat-l">due today</span>
    </div>
    <div class="stat stat-shared">
      <span class="stat-n">{p.sharedCount}</span>
      <span class="stat-l">shared with {partnerLabel(p.others)}</span>
    </div>
  </div>
);

/** "3 open", "All done" or "Empty". */
export function rowStatus(l: Pick<ListSummary, "total" | "done">): string {
  if (l.total === 0) return "Empty";
  const open = l.total - l.done;
  return open === 0 ? "All done" : `${open} open`;
}

/** "Private", "with Bob" (I shared it) or "from Bob" (shared with me). */
export function rowAudience(l: Pick<ListSummary, "shared" | "owner_id">, meId: number, others: PublicUser[]): string {
  if (!l.shared) return "Private";
  if (l.owner_id === meId) return `with ${partnerLabel(others)}`;
  return `from ${others.find((u) => u.id === l.owner_id)?.display_name ?? "someone"}`;
}

/** Sidebar row: a progress ring in the list colour with the open count inside. */
export const ListRow: FC<{
  l: ListSummary;
  filter: Filter;
  current: boolean;
  meId: number;
  others: PublicUser[];
  oob?: boolean;
}> = ({ l, filter, current, meId, others, ...p }) => {
  const progress = pct(l.done, l.total);
  const open = l.total - l.done;
  const complete = l.total > 0 && open === 0;
  return (
    <a
      id={`row-${l.id}`}
      href={listHref(l.id, filter, "todo")}
      hx-boost="false"
      class={`row c-${l.color}${complete ? " is-complete" : ""}`}
      aria-current={current ? "page" : undefined}
      {...oob(p.oob ? "true" : undefined)}
    >
      <span class="ring" aria-hidden="true">
        <svg viewBox="0 0 36 36" width="40" height="40">
          <circle class="ring-track" cx="18" cy="18" r="15" />
          {progress > 0 ? (
            <circle
              class="ring-fill"
              cx="18"
              cy="18"
              r="15"
              pathLength="100"
              stroke-dasharray={`${progress} 100`}
              transform="rotate(-90 18 18)"
            />
          ) : null}
        </svg>
        <span class="ring-n">{complete ? <CheckIcon size={14} /> : open}</span>
      </span>
      <span class="row-text">
        <span class="row-name">{l.name}</span>
        <span class="row-sub">
          <span class="row-open">{rowStatus(l)}</span>
          <span class="row-dot" aria-hidden="true">·</span>
          <span class={l.shared ? "row-shared" : "row-private"}>{rowAudience(l, meId, others)}</span>
        </span>
      </span>
      <span class="row-chev" aria-hidden="true">
        <ChevronRight size={18} />
      </span>
    </a>
  );
};

export const Progress: FC<{ done: number; total: number; oob?: boolean }> = (p) => (
  <div class="progress" id="progress" {...oob(p.oob ? "true" : undefined)}>
    <progress class="bar" max={100} value={pct(p.done, p.total)} aria-label="Progress"></progress>
    <span class="progress-text">
      {p.done} of {p.total} done
    </span>
  </div>
);

export const Tabs: FC<{ listId: number; filter: Filter; tab: Tab; done: number; total: number; oob?: boolean }> = (p) => {
  const tabs: [Tab, string][] = [
    ["todo", `To do ${p.total - p.done}`],
    ["done", `Done ${p.done}`],
    ["all", "All"],
  ];
  return (
    <nav class="tabs" id="tabs" aria-label="Show tasks" {...oob(p.oob ? "true" : undefined)}>
      {tabs.map(([id, label]) => (
        <a href={listHref(p.listId, p.filter, id)} class="tab" aria-current={p.tab === id ? "true" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
};

/** Avatar button that opens a small menu: change password (not wired up yet) and log out. */
const AccountMenu: FC<{ me: PublicUser; csrf: string }> = ({ me, csrf }) => (
  <div class="acct" x-data="menu" {...{ "x-on:keydown.escape": "close", "x-on:click.outside": "close" }}>
    <button
      type="button"
      class={`avatar avatar-lg av-${avatarIndex(me.avatar_color)}`}
      aria-label={`Account menu for ${me.display_name}`}
      aria-haspopup="menu"
      aria-controls="acct-menu"
      aria-expanded="false"
      x-bind:aria-expanded="expanded"
      x-on:click="toggle"
      x-ref="trigger"
    >
      {initials(me.display_name)}
    </button>
    <div id="acct-menu" class="acct-menu" role="menu" aria-label="Account" x-cloak x-show="open">
      <div class="acct-head">
        <span class="acct-name">{me.display_name}</span>
        <span class="acct-user">@{me.username}</span>
      </div>
      <button type="button" class="acct-item" role="menuitem" aria-haspopup="dialog" x-on:click="changePassword">
        <KeyIcon size={17} />
        Change password
      </button>
      <form method="post" action="/logout" hx-boost="false">
        <CsrfField token={csrf} />
        <button type="submit" class="acct-item acct-item-danger" role="menuitem">
          <LogoutIcon size={17} />
          Log out
        </button>
      </form>
    </div>
    <PasswordDialog csrf={csrf} />
  </div>
);

/** Modal for choosing a new password. Limits come from the shared policy; the server re-checks them. */
const PasswordDialog: FC<{ csrf: string }> = ({ csrf }) => (
  <dialog id="pw-dialog" class="modal" aria-labelledby="pw-title" x-data="pwchange" x-on:close="reset">
    <form
      method="post"
      action="/account/password"
      class="modal-body"
      hx-boost="false"
      novalidate
      x-show="editing"
      {...{ "x-on:submit.prevent": "submit" }}
    >
      <CsrfField token={csrf} />
      <div class="modal-head">
        <h2 id="pw-title">Change password</h2>
        <p id="pw-hint">At least {PASSWORD_MIN} characters. A few words strung together work well.</p>
      </div>
      <label class="field">
        New password
        <div class="pw" x-data="password">
          <input
            type="password"
            name="password"
            autocomplete="new-password"
            placeholder="New password"
            required
            minlength={PASSWORD_MIN}
            maxlength={PASSWORD_MAX}
            aria-describedby="pw-hint pw-error"
            x-bind:type="type"
            x-bind:aria-invalid="invalid"
          />
          <button type="button" class="pw-toggle" x-on:click="toggle" x-bind:aria-label="aria" x-text="label">
            Show
          </button>
        </div>
      </label>
      <p id="pw-error" class="form-error" role="alert" x-cloak x-show="error" x-text="error"></p>
      <div class="modal-actions">
        <button type="button" class="btn-ghost" x-on:click="cancel">
          Cancel
        </button>
        <button type="submit" class="btn-accent" x-bind:disabled="busy">
          Save
        </button>
      </div>
    </form>
    <div class="modal-body" x-cloak x-show="done">
      <div class="modal-head">
        <h2>Password updated</h2>
        <p>Use it next time you sign in. Any other devices have been signed out.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-accent" x-on:click="cancel">
          Done
        </button>
      </div>
    </div>
  </dialog>
);

const Sidebar: FC<AppProps> = (p) => {
  const visible = p.lists.filter((l) => matchesFilter(l, p.filter));
  const sharedCount = p.lists.filter((l) => l.shared).length;
  return (
    <aside class="side" aria-label="Lists">
      <div class="side-top">
        <a href="/" class="brand" aria-label="Tandem home" hx-boost="false">
          <Logo width={30} />
          <span class="brand-name">Tandem</span>
        </a>
        <div class="side-actions">
          <ThemeToggle theme={p.theme} csrf={p.csrf} next={p.path} />
          <AccountMenu me={p.me} csrf={p.csrf} />
        </div>
      </div>

      <div class="side-head">
        <h1 class="side-title">Your lists</h1>
        <Stats dueToday={p.dueToday} sharedCount={sharedCount} others={p.others} />
        <nav class="seg" aria-label="Filter lists">
          {(["all", "shared", "private"] as const).map((f) => (
            <a
              href={listHref(p.view === "detail" && p.selected ? p.selected.id : null, f, p.tab)}
              class="seg-btn"
              aria-current={p.filter === f ? "true" : undefined}
            >
              {f[0]!.toUpperCase() + f.slice(1)}
            </a>
          ))}
        </nav>
      </div>

      <div class="rows">
        {visible.map((l) => (
          <ListRow l={l} filter={p.filter} current={p.selected?.id === l.id} meId={p.me.id} others={p.others} />
        ))}
        {visible.length === 0 ? (
          <p class="rows-empty">{p.lists.length ? `No ${p.filter} lists.` : "No lists yet."}</p>
        ) : null}
      </div>

      <form method="post" action="/lists" class="side-foot" hx-boost="false">
        <CsrfField token={p.csrf} />
        <button type="submit" class="btn-invert">
          <PlusIcon size={18} /> New list
        </button>
      </form>
    </aside>
  );
};

export const ItemRow: FC<{
  it: ItemView;
  showWho: boolean;
  today: Date;
  csrf: string;
  isNew: boolean;
  next: string;
  /** Replace this element (e.g. the optimistic placeholder) instead of rendering in place. */
  replaces?: string;
}> = ({ it, showWho, today, csrf, isNew, next, replaces }) => {
  const due = it.due_date && !it.done ? dueLabel(today, it.due_date) : null;
  return (
    <li
      id={`item-${it.id}`}
      class={`item${it.done ? " is-done" : ""}${isNew ? " is-new" : ""}`}
      x-data="item"
      {...oob(replaces ? `outerHTML:#${replaces}` : undefined)}
    >
      <form method="post" action={`/items/${it.id}/toggle`} hx-swap="innerHTML swap:180ms" x-on:submit="toggle">
        <CsrfField token={csrf} />
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          class="tick"
          aria-label={(it.done ? "Mark not done: " : "Mark done: ") + it.title}
          aria-pressed={it.done ? "true" : "false"}
        >
          <span class="box">
            <CheckIcon size={14} />
          </span>
        </button>
      </form>
      <div class="item-body">
        <span class="item-title">{it.title}</span>
        {showWho || due ? (
          <div class="item-meta">
            {showWho ? (
              <span class="who">
                <Avatar user={{ display_name: it.creator_name, avatar_color: it.creator_color }} size="xs" />
                {it.creator_name}
              </span>
            ) : null}
            {due ? <span class={`due${due.overdue ? " is-overdue" : ""}`}>{due.label}</span> : null}
          </div>
        ) : null}
      </div>
      <form
        method="post"
        action={`/items/${it.id}/delete`}
        hx-swap="innerHTML swap:220ms"
        x-on:submit="remove"
        class="item-del"
      >
        <CsrfField token={csrf} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" class="icon-btn icon-btn-ghost" aria-label={`Delete: ${it.title}`}>
          <XIcon size={16} />
        </button>
      </form>
    </li>
  );
};

const Detail: FC<AppProps & { list: List }> = (p) => {
  const { list, items } = p;
  const isOwner = list.owner_id === p.me.id;
  const isShared = !!list.shared;
  const doneCount = items.filter((i) => i.done).length;
  const shown = items.filter((i) => p.tab === "all" || (p.tab === "done" ? i.done : !i.done));
  const partner = partnerLabel(p.others);
  const back = listHref(null, p.filter, "todo");
  // Optimistic adds only make sense where the new task will be visible.
  const optimistic = p.tab !== "done";
  const owner = isOwner ? p.me : p.others.find((u) => u.id === list.owner_id);
  const collaborators = isShared ? [p.me, ...p.others] : [];
  const emptyText =
    items.length === 0
      ? "Empty list. Add the first task above."
      : p.tab === "done"
        ? "Nothing done yet."
        : "All done. Nice work.";

  return (
    <div class={`inner c-${list.color}`}>
      <div class="detail-bar">
        <a href={back} class="icon-btn back" aria-label="Back to your lists" hx-boost="false">
          <ChevronLeft />
        </a>
        <div class="spacer"></div>
        {isOwner ? (
          <>
            <form method="post" action={`/lists/${list.id}/share`} x-data="switcher" x-on:submit="flip" hx-swap="innerHTML swap:200ms">
              <CsrfField token={p.csrf} />
              <input type="hidden" name="shared" value={isShared ? "0" : "1"} />
              <input type="hidden" name="next" value={p.path} />
              <button type="submit" role="switch" aria-checked={isShared ? "true" : "false"} class="share">
                <span class="share-text">
                  <span class="share-title">Share with {partner}</span>
                  <span class="share-sub">{isShared ? `${partner[0]!.toUpperCase() + partner.slice(1)} can see and edit` : "Private to you"}</span>
                </span>
                <span class="switch" aria-hidden="true">
                  <span class="knob"></span>
                </span>
              </button>
            </form>
            <form
              method="post"
              action={`/lists/${list.id}/delete`}
              hx-boost="false"
              x-data="confirmer"
              x-on:submit="ask"
              data-confirm={`Delete “${list.name}” and all its tasks?`}
            >
              <CsrfField token={p.csrf} />
              <button type="submit" class="icon-btn" aria-label={`Delete list ${list.name}`}>
                <TrashIcon size={19} />
              </button>
            </form>
          </>
        ) : (
          <span class="badge-shared badge-lg">Shared by {owner?.display_name ?? "someone"}</span>
        )}
      </div>

      <div class="title-block">
        {isOwner ? (
          <form method="post" action={`/lists/${list.id}/rename`} x-data="autosubmit" class="title-form">
            <CsrfField token={p.csrf} />
            <input type="hidden" name="next" value={p.path} />
            <label class="sr-only" for="list-name">
              List name
            </label>
            <input
              id="list-name"
              class="title"
              type="text"
              name="name"
              value={list.name}
              maxlength={80}
              required
              autocomplete="off"
              autofocus={p.renaming}
              x-on:change="submit"
              x-init={p.renaming ? "select" : undefined}
            />
          </form>
        ) : (
          <h2 class="title">{list.name}</h2>
        )}
        <div class="audience">
          {isShared ? (
            <span class="together">
              <span class="stack">
                {collaborators.map((u) => (
                  <Avatar user={u} size="sm" />
                ))}
              </span>
              <span class="together-text">
                {collaborators.length === 1 ? "Shared" : `You and ${partner}`}
              </span>
            </span>
          ) : (
            <span class="private">
              <LockIcon size={15} /> Only you can see this list
            </span>
          )}
        </div>
      </div>

      <Progress done={doneCount} total={items.length} />

      <form
        method="post"
        action={`/lists/${list.id}/items`}
        class="add"
        {...(optimistic ? { "hx-boost": "false", "x-data": "adder", "x-on:submit.prevent": "submit" } : {})}
      >
        <CsrfField token={p.csrf} />
        <input type="hidden" name="tab" value={p.tab} />
        <input type="hidden" name="filter" value={p.filter} />
        <label class="sr-only" for="new-task">
          New task
        </label>
        <input
          id="new-task"
          class="add-title"
          type="text"
          name="title"
          placeholder="Add a task…"
          maxlength={200}
          required
          autocomplete="off"
          autofocus={p.addedId !== undefined}
        />
        <label class="sr-only" for="new-due">
          Due date (optional)
        </label>
        <input id="new-due" class="add-due" type="date" name="due" />
        <button type="submit" class="add-btn" aria-label="Add task">
          <PlusIcon />
        </button>
        {optimistic ? <p class="add-error" role="alert" x-ref="error"></p> : null}
      </form>

      <Tabs listId={list.id} filter={p.filter} tab={p.tab} done={doneCount} total={items.length} />

      {optimistic ? (
        <template id="pending-item">
          <li class="item is-new is-pending" aria-busy="true">
            <span class="tick" aria-hidden="true">
              <span class="box">
                <CheckIcon size={14} />
              </span>
            </span>
            <div class="item-body">
              <span class="item-title"></span>
              {isShared ? (
                <div class="item-meta">
                  <span class="who">
                    <Avatar user={p.me} size="xs" />
                    {p.me.display_name}
                  </span>
                </div>
              ) : null}
            </div>
          </li>
        </template>
      ) : null}

      <ul class="items" aria-label="Tasks">
        {shown.map((it) => (
          <ItemRow it={it} showWho={isShared} today={p.today} csrf={p.csrf} isNew={it.id === p.addedId} next={p.path} />
        ))}
        {shown.length === 0 ? <li class="items-empty">{emptyText}</li> : null}
      </ul>
    </div>
  );
};

export const AppPage: FC<AppProps> = (p) => (
  <Layout title={p.selected ? `${p.selected.name} — Tandem` : "Tandem — Lists"} theme={p.theme} page="app">
    <div class={`tdm app view-${p.view}`}>
      <Sidebar {...p} />
      <main class="main">
        {p.selected ? (
          <Detail {...p} list={p.selected} />
        ) : (
          <div class="inner nothing">
            <Logo width={64} />
            <h2>No list selected</h2>
            <p class="muted">Create a list to get started.</p>
          </div>
        )}
      </main>
    </div>
  </Layout>
);

export interface AddedProps {
  cid: string;
  item: ItemView;
  list: ListSummary;
  me: PublicUser;
  others: PublicUser[];
  filter: Filter;
  tab: Tab;
  today: Date;
  dueToday: number;
  sharedCount: number;
  csrf: string;
}

/**
 * Response to an optimistic add: the real row replaces the placeholder, and the
 * counters that changed are updated out-of-band. Nothing else on the page is touched.
 */
export const AddedFragment: FC<AddedProps> = (p) => (
  <>
    <ItemRow
      it={p.item}
      showWho={!!p.list.shared}
      today={p.today}
      csrf={p.csrf}
      isNew={false}
      next={listHref(p.list.id, p.filter, p.tab)}
      replaces={`pending-${p.cid}`}
    />
    <Progress done={p.list.done} total={p.list.total} oob />
    <Tabs listId={p.list.id} filter={p.filter} tab={p.tab} done={p.list.done} total={p.list.total} oob />
    <Stats dueToday={p.dueToday} sharedCount={p.sharedCount} others={p.others} oob />
    {matchesFilter(p.list, p.filter) ? (
      <ListRow l={p.list} filter={p.filter} current meId={p.me.id} others={p.others} oob />
    ) : null}
  </>
);
