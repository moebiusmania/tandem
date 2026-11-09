import { describe, expect, test } from "bun:test";
import { createOrResetUser, parseArgs } from "../../src/cli/create-user";
import { verifyPassword } from "../../src/auth/password";
import { openDatabase } from "../../src/db/database";
import { createSession } from "../../src/repo/sessions";
import { findUserByUsername } from "../../src/repo/users";
import { FAST_ARGON } from "../helpers";

const base = { now: 1, argon2: FAST_ARGON };

describe("create-user CLI", () => {
  test("parseArgs", () => {
    expect(parseArgs(["alice", "--name", "Alice L", "--password", "pw", "--reset", "extra", "--unknown"])).toEqual({
      username: "alice", displayName: "Alice L", password: "pw", reset: true,
    });
    expect(parseArgs([])).toEqual({ reset: false });
  });
  test("creates a user with a generated password", async () => {
    const db = openDatabase();
    const r = await createOrResetUser(db, { ...base, username: "Alice" });
    expect(r).toMatchObject({ username: "alice", created: true });
    expect(r.password).toHaveLength(20);
    const u = findUserByUsername(db, "alice")!;
    expect(u.display_name).toBe("Alice");
    expect(u.password_hash).not.toContain(r.password);
    expect(await verifyPassword(r.password, u.password_hash)).toBe(true);
  });
  test("custom name and password; rejects weak passwords and bad usernames", async () => {
    const db = openDatabase();
    await createOrResetUser(db, { ...base, username: "bob", displayName: " Bob Smith ", password: "a long passphrase" });
    expect(findUserByUsername(db, "bob")?.display_name).toBe("Bob Smith");
    await expect(createOrResetUser(db, { ...base, username: "bob", password: "short" })).rejects.toThrow("Password rejected: Use at least 12 characters.");
    await expect(createOrResetUser(db, { ...base, username: "a b" })).rejects.toThrow();
  });
  test("existing user requires --reset, which rotates password and kills sessions", async () => {
    const db = openDatabase();
    const first = await createOrResetUser(db, { ...base, username: "alice" });
    await expect(createOrResetUser(db, { ...base, username: "alice" })).rejects.toThrow(/already exists/);
    const u = findUserByUsername(db, "alice")!;
    createSession(db, { userId: u.id, persistent: false, now: 1, policy: { idleMs: 1, absoluteMs: 1, persistentIdleMs: 1, persistentAbsoluteMs: 1 } });
    const r = await createOrResetUser(db, { ...base, username: "alice", reset: true });
    expect(r.created).toBe(false);
    expect(r.password).not.toBe(first.password);
    expect(await verifyPassword(r.password, findUserByUsername(db, "alice")!.password_hash)).toBe(true);
    expect((db.query("SELECT COUNT(*) n FROM sessions").get() as any).n).toBe(0);
  });
});
