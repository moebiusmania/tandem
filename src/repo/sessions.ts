import type { Database } from "bun:sqlite";
import { randomToken, sha256 } from "../lib/crypto";

export interface Session {
  id_hash: string;
  user_id: number;
  csrf_token: string;
  persistent: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

export interface SessionPolicy {
  idleMs: number;
  absoluteMs: number;
  persistentIdleMs: number;
  persistentAbsoluteMs: number;
}

/** Create a session. Returns the raw token (only ever stored client-side) and the row. */
export function createSession(
  db: Database,
  input: { userId: number; persistent: boolean; now: number; policy: SessionPolicy },
): { token: string; session: Session } {
  const token = randomToken();
  const abs = input.persistent ? input.policy.persistentAbsoluteMs : input.policy.absoluteMs;
  const session = db
    .query(
      `INSERT INTO sessions (id_hash, user_id, csrf_token, persistent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(sha256(token), input.userId, randomToken(), input.persistent ? 1 : 0, input.now, input.now, input.now + abs) as Session;
  return { token, session };
}

/**
 * Look up a session by raw token, enforcing absolute and idle expiry.
 * Expired sessions are deleted. A valid session's last-seen time is refreshed.
 */
export function validateSession(
  db: Database,
  token: string,
  now: number,
  policy: SessionPolicy,
): Session | null {
  const idHash = sha256(token);
  const s = db.query("SELECT * FROM sessions WHERE id_hash = ?").get(idHash) as Session | null;
  if (!s) return null;
  const idle = s.persistent ? policy.persistentIdleMs : policy.idleMs;
  if (now >= s.expires_at || now - s.last_seen_at >= idle) {
    deleteSession(db, idHash);
    return null;
  }
  db.query("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").run(now, idHash);
  return { ...s, last_seen_at: now };
}

export function deleteSession(db: Database, idHash: string): void {
  db.query("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
}

export function deleteUserSessions(db: Database, userId: number): void {
  db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Sign a user out everywhere except the given session. Returns how many were removed. */
export function deleteOtherSessions(db: Database, userId: number, keepIdHash: string): number {
  return db.query("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?").run(userId, keepIdHash).changes;
}

export function purgeExpiredSessions(db: Database, now: number): number {
  return db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes;
}
