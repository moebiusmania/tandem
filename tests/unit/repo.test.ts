import { describe, expect, test } from "bun:test";
import { migrate, openDatabase } from "../../src/db/database";
import {
  addItem, countItems, countOwnedLists, createList, deleteItem, deleteList, dueTodayCount, getAccessibleItem,
  getAccessibleList, itemsForList, listsForUser, renameList, setListShared, toggleItem,
} from "../../src/repo/lists";
import {
  createSession, deleteSession, deleteUserSessions, purgeExpiredSessions, validateSession,
} from "../../src/repo/sessions";
import {
  AVATAR_COLORS, createUser, findUserById, findUserByUsername, initials, isLocked, listUsers, recordFailedLogin,
  resetFailedLogins, updatePassword,
} from "../../src/repo/users";
import { sha256 } from "../../src/lib/crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const policy = { idleMs: 100, absoluteMs: 1000, persistentIdleMs: 500, persistentAbsoluteMs: 5000 };

function fresh() {
  const db = openDatabase();
  const s = createUser(db, { username: "alice", displayName: "Alice", passwordHash: "h1", now: 1 });
  const g = createUser(db, { username: "bob", displayName: "Bob S", passwordHash: "h2", now: 1 });
  return { db, s, g };
}

describe("database", () => {
  test("migrations are idempotent and enable foreign keys", () => {
    const db = openDatabase();
    migrate(db);
    expect((db.query("PRAGMA user_version").get() as any).user_version).toBe(1);
    expect((db.query("PRAGMA foreign_keys").get() as any).foreign_keys).toBe(1);
  });
  test("file databases use WAL", () => {
    const dir = mkdtempSync(join(tmpdir(), "tandem-"));
    try {
      const db = openDatabase(join(dir, "t.sqlite"));
      expect((db.query("PRAGMA journal_mode").get() as any).journal_mode).toBe("wal");
      expect(statSync(join(dir, "t.sqlite")).mode & 0o777).toBe(0o600);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("users", () => {
  test("create, find (case-insensitive), list, colours rotate", () => {
    const { db, s, g } = fresh();
    expect(s.avatar_color).toBe(AVATAR_COLORS[0]);
    expect(g.avatar_color).toBe(AVATAR_COLORS[1]);
    expect(findUserByUsername(db, "ALICE")?.id).toBe(s.id);
    expect(findUserByUsername(db, "nobody")).toBeNull();
    expect(findUserById(db, g.id)?.username).toBe("bob");
    expect(findUserById(db, 999)).toBeNull();
    const listed = listUsers(db);
    expect(listed.map((u) => u.username)).toEqual(["alice", "bob"]);
    expect(listed[0]).not.toHaveProperty("password_hash");
  });
  test("duplicate usernames are rejected", () => {
    const { db } = fresh();
    expect(() => createUser(db, { username: "Alice", displayName: "x", passwordHash: "h", now: 1 })).toThrow();
  });
  test("lockout after max failures, reset on success", () => {
    const { db, s } = fresh();
    const opts = { now: 1000, maxFailures: 3, lockoutMs: 500 };
    expect(recordFailedLogin(db, s.id, opts).locked).toBe(false);
    expect(recordFailedLogin(db, s.id, opts).locked).toBe(false);
    expect(recordFailedLogin(db, s.id, opts).locked).toBe(true);
    const u = findUserById(db, s.id)!;
    expect(u.locked_until).toBe(1500);
    expect(isLocked(u, 1499)).toBe(true);
    expect(isLocked(u, 1500)).toBe(false);
    recordFailedLogin(db, s.id, opts);
    resetFailedLogins(db, s.id);
    expect(findUserById(db, s.id)).toMatchObject({ failed_attempts: 0, locked_until: null });
  });
  test("updatePassword clears lockout", () => {
    const { db, s } = fresh();
    recordFailedLogin(db, s.id, { now: 0, maxFailures: 1, lockoutMs: 99 });
    updatePassword(db, s.id, "new");
    expect(findUserById(db, s.id)).toMatchObject({ password_hash: "new", locked_until: null });
  });
  test("initials", () => {
    expect(initials("Alice")).toBe("A");
    expect(initials("  bob   smith jones ")).toBe("BS");
  });
});

describe("sessions", () => {
  test("only the hash of the token is stored", () => {
    const { db, s } = fresh();
    const { token, session } = createSession(db, { userId: s.id, persistent: false, now: 0, policy });
    expect(session.id_hash).toBe(sha256(token));
    expect(db.query("SELECT * FROM sessions WHERE id_hash = ?").get(token)).toBeNull();
    expect(session.csrf_token).not.toBe(token);
  });
  test("idle timeout, refresh on use, absolute timeout", () => {
    const { db, s } = fresh();
    const { token } = createSession(db, { userId: s.id, persistent: false, now: 0, policy });
    expect(validateSession(db, token, 90, policy)?.last_seen_at).toBe(90);
    expect(validateSession(db, token, 180, policy)).not.toBeNull(); // refreshed at 90
    expect(validateSession(db, token, 280, policy)).toBeNull(); // idle 100
    expect(validateSession(db, token, 281, policy)).toBeNull(); // deleted
    const p = createSession(db, { userId: s.id, persistent: true, now: 0, policy });
    for (let t = 400; t < 5000; t += 400) expect(validateSession(db, p.token, t, policy)).not.toBeNull();
    expect(validateSession(db, p.token, 5000, policy)).toBeNull(); // absolute
  });
  test("unknown token", () => {
    const { db } = fresh();
    expect(validateSession(db, "nope", 0, policy)).toBeNull();
  });
  test("delete, delete all for user, purge", () => {
    const { db, s, g } = fresh();
    const a = createSession(db, { userId: s.id, persistent: false, now: 0, policy });
    createSession(db, { userId: s.id, persistent: false, now: 0, policy });
    const c = createSession(db, { userId: g.id, persistent: true, now: 0, policy });
    deleteSession(db, a.session.id_hash);
    expect(validateSession(db, a.token, 1, policy)).toBeNull();
    deleteUserSessions(db, s.id);
    expect((db.query("SELECT COUNT(*) n FROM sessions").get() as any).n).toBe(1);
    expect(purgeExpiredSessions(db, 4999)).toBe(0);
    expect(purgeExpiredSessions(db, 5000)).toBe(1);
    expect(validateSession(db, c.token, 1, policy)).toBeNull();
  });
});

describe("lists and items", () => {
  test("access control: owner or shared", () => {
    const { db, s, g } = fresh();
    const priv = createList(db, { ownerId: s.id, name: "Mine", now: 1 });
    const shared = createList(db, { ownerId: s.id, name: "Ours", now: 2 });
    setListShared(db, shared.id, true);
    expect(getAccessibleList(db, priv.id, s.id)?.name).toBe("Mine");
    expect(getAccessibleList(db, priv.id, g.id)).toBeNull();
    expect(getAccessibleList(db, shared.id, g.id)?.name).toBe("Ours");
    expect(listsForUser(db, g.id).map((l) => l.name)).toEqual(["Ours"]);
    const it = addItem(db, { listId: priv.id, title: "secret", createdBy: s.id, dueDate: null, now: 1 });
    expect(getAccessibleItem(db, it.id, g.id)).toBeNull();
    expect(getAccessibleItem(db, it.id, s.id)?.title).toBe("secret");
    setListShared(db, shared.id, false);
    expect(getAccessibleList(db, shared.id, g.id)).toBeNull();
  });
  test("colours rotate per owner; counts", () => {
    const { db, s } = fresh();
    const colors = Array.from({ length: 6 }, (_, i) => createList(db, { ownerId: s.id, name: `L${i}`, now: i }).color);
    expect(colors).toEqual([0, 1, 2, 3, 4, 0]);
    expect(countOwnedLists(db, s.id)).toBe(6);
  });
  test("summaries, ordering, toggle, rename, delete cascade", () => {
    const { db, s, g } = fresh();
    const l = createList(db, { ownerId: s.id, name: "Groceries", now: 1 });
    const a = addItem(db, { listId: l.id, title: "A", createdBy: s.id, dueDate: "2026-11-08", now: 1 });
    const b = addItem(db, { listId: l.id, title: "B", createdBy: g.id, dueDate: null, now: 2 });
    toggleItem(db, a.id, 50);
    expect(listsForUser(db, s.id)[0]).toMatchObject({ total: 2, done: 1 });
    const items = itemsForList(db, l.id);
    expect(items.map((i) => i.title)).toEqual(["B", "A"]); // open first
    expect(items[0]).toMatchObject({ creator_name: "Bob S" });
    expect(items[1]).toMatchObject({ done: 1, done_at: 50 });
    toggleItem(db, a.id, 60);
    expect(itemsForList(db, l.id).find((i) => i.id === a.id)).toMatchObject({ done: 0, done_at: null });
    renameList(db, l.id, "Food");
    expect(getAccessibleList(db, l.id, s.id)?.name).toBe("Food");
    deleteItem(db, b.id);
    expect(countItems(db, l.id)).toBe(1);
    deleteList(db, l.id);
    expect(countItems(db, l.id)).toBe(0);
    expect(listsForUser(db, s.id)).toEqual([]);
  });
  test("due today counts open, accessible, due-or-overdue items", () => {
    const { db, s, g } = fresh();
    const mine = createList(db, { ownerId: s.id, name: "Mine", now: 1 });
    const hers = createList(db, { ownerId: g.id, name: "Hers", now: 1 });
    const add = (listId: number, due: string | null) =>
      addItem(db, { listId, title: "t", createdBy: s.id, dueDate: due, now: 1 });
    add(mine.id, "2026-11-08");
    add(mine.id, "2026-11-01");
    add(mine.id, "2026-11-09");
    add(mine.id, null);
    toggleItem(db, add(mine.id, "2026-11-08").id, 1);
    add(hers.id, "2026-11-08");
    expect(dueTodayCount(db, s.id, "2026-11-08")).toBe(2);
    setListShared(db, hers.id, true);
    expect(dueTodayCount(db, s.id, "2026-11-08")).toBe(3);
  });
});
