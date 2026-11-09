import type { Database } from "bun:sqlite";

export interface User {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  avatar_color: string;
  failed_attempts: number;
  locked_until: number | null;
  created_at: number;
}

/** Fields safe to expose to views (never the hash or lockout state). */
export type PublicUser = Pick<User, "id" | "username" | "display_name" | "avatar_color">;

export const AVATAR_COLORS = ["#7DD3FC", "#FFB86B", "#9BE15D", "#F9A8D4", "#A99BFF"] as const;

export function createUser(
  db: Database,
  input: { username: string; displayName: string; passwordHash: string; now: number },
): User {
  const { n } = db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  const color = AVATAR_COLORS[n % AVATAR_COLORS.length]!;
  return db
    .query(
      `INSERT INTO users (username, display_name, password_hash, avatar_color, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(input.username, input.displayName, input.passwordHash, color, input.now) as User;
}

export function findUserByUsername(db: Database, username: string): User | null {
  return db.query("SELECT * FROM users WHERE username = ?").get(username) as User | null;
}

export function findUserById(db: Database, id: number): User | null {
  return db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
}

export function listUsers(db: Database): PublicUser[] {
  return db
    .query("SELECT id, username, display_name, avatar_color FROM users ORDER BY id")
    .all() as PublicUser[];
}

export function updatePassword(db: Database, id: number, passwordHash: string): void {
  db.query("UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(
    passwordHash,
    id,
  );
}

/** Record a failed login; lock the account once `maxFailures` consecutive failures are reached. */
export function recordFailedLogin(
  db: Database,
  id: number,
  opts: { now: number; maxFailures: number; lockoutMs: number },
): { locked: boolean } {
  const row = db
    .query("UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ? RETURNING failed_attempts")
    .get(id) as { failed_attempts: number };
  if (row.failed_attempts >= opts.maxFailures) {
    db.query("UPDATE users SET locked_until = ?, failed_attempts = 0 WHERE id = ?").run(
      opts.now + opts.lockoutMs,
      id,
    );
    return { locked: true };
  }
  return { locked: false };
}

export function resetFailedLogins(db: Database, id: number): void {
  db.query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(id);
}

export function isLocked(user: Pick<User, "locked_until">, now: number): boolean {
  return user.locked_until !== null && user.locked_until > now;
}

export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
