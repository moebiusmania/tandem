import type { Database } from "bun:sqlite";

export const LIST_COLORS = ["#9BE15D", "#A99BFF", "#FFB86B", "#7DD3FC", "#F9A8D4"] as const;
export const MAX_LISTS_PER_USER = 200;
export const MAX_ITEMS_PER_LIST = 1000;

export interface List {
  id: number;
  owner_id: number;
  name: string;
  color: number;
  shared: number;
  created_at: number;
}

export interface ListSummary extends List {
  total: number;
  done: number;
}

export interface Item {
  id: number;
  list_id: number;
  title: string;
  created_by: number;
  due_date: string | null;
  done: number;
  done_at: number | null;
  created_at: number;
}

export interface ItemView extends Item {
  creator_name: string;
  creator_color: string;
}

/** A user can access a list they own, or any list flagged as shared. */
const ACCESS = "(l.owner_id = :user OR l.shared = 1)";

export function listsForUser(db: Database, userId: number): ListSummary[] {
  return db
    .query(
      `SELECT l.*, COUNT(i.id) AS total, COALESCE(SUM(i.done), 0) AS done
       FROM lists l LEFT JOIN items i ON i.list_id = l.id
       WHERE ${ACCESS}
       GROUP BY l.id ORDER BY l.created_at, l.id`,
    )
    .all({ user: userId }) as ListSummary[];
}

export function getAccessibleList(db: Database, listId: number, userId: number): List | null {
  return db
    .query(`SELECT l.* FROM lists l WHERE l.id = :id AND ${ACCESS}`)
    .get({ id: listId, user: userId }) as List | null;
}

export function countOwnedLists(db: Database, userId: number): number {
  return (db.query("SELECT COUNT(*) AS n FROM lists WHERE owner_id = ?").get(userId) as { n: number }).n;
}

export function createList(db: Database, input: { ownerId: number; name: string; now: number }): List {
  const color = countOwnedLists(db, input.ownerId) % LIST_COLORS.length;
  return db
    .query("INSERT INTO lists (owner_id, name, color, created_at) VALUES (?, ?, ?, ?) RETURNING *")
    .get(input.ownerId, input.name, color, input.now) as List;
}

export function renameList(db: Database, listId: number, name: string): void {
  db.query("UPDATE lists SET name = ? WHERE id = ?").run(name, listId);
}

export function setListShared(db: Database, listId: number, shared: boolean): void {
  db.query("UPDATE lists SET shared = ? WHERE id = ?").run(shared ? 1 : 0, listId);
}

export function deleteList(db: Database, listId: number): void {
  db.query("DELETE FROM lists WHERE id = ?").run(listId);
}

export function itemsForList(db: Database, listId: number): ItemView[] {
  return db
    .query(
      `SELECT i.*, u.display_name AS creator_name, u.avatar_color AS creator_color
       FROM items i JOIN users u ON u.id = i.created_by
       WHERE i.list_id = ?
       ORDER BY i.done, i.created_at DESC, i.id DESC`,
    )
    .all(listId) as ItemView[];
}

export function countItems(db: Database, listId: number): number {
  return (db.query("SELECT COUNT(*) AS n FROM items WHERE list_id = ?").get(listId) as { n: number }).n;
}

export function addItem(
  db: Database,
  input: { listId: number; title: string; createdBy: number; dueDate: string | null; now: number },
): Item {
  return db
    .query(
      "INSERT INTO items (list_id, title, created_by, due_date, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *",
    )
    .get(input.listId, input.title, input.createdBy, input.dueDate, input.now) as Item;
}

/** Fetch an item only if the user can access its list. */
export function getAccessibleItem(db: Database, itemId: number, userId: number): Item | null {
  return db
    .query(`SELECT i.* FROM items i JOIN lists l ON l.id = i.list_id WHERE i.id = :id AND ${ACCESS}`)
    .get({ id: itemId, user: userId }) as Item | null;
}

export function toggleItem(db: Database, itemId: number, now: number): void {
  db.query(
    "UPDATE items SET done = 1 - done, done_at = CASE WHEN done = 0 THEN ? ELSE NULL END WHERE id = ?",
  ).run(now, itemId);
}

export function deleteItem(db: Database, itemId: number): void {
  db.query("DELETE FROM items WHERE id = ?").run(itemId);
}

/** Open items due today (or overdue) across every list the user can access. */
export function dueTodayCount(db: Database, userId: number, today: string): number {
  return (
    db
      .query(
        `SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id
         WHERE ${ACCESS} AND i.done = 0 AND i.due_date IS NOT NULL AND i.due_date <= :today`,
      )
      .get({ user: userId, today }) as { n: number }
  ).n;
}
