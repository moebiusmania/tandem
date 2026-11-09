import type { Database } from "bun:sqlite";
import type { Argon2Options } from "../auth/password";
import { hashPassword } from "../auth/password";
import { generatePassword } from "../lib/crypto";
import { passwordSchema, usernameSchema } from "../lib/validation";
import { deleteUserSessions } from "../repo/sessions";
import { createUser, findUserByUsername, updatePassword } from "../repo/users";

export interface CreateUserResult {
  username: string;
  password: string;
  created: boolean;
}

/**
 * Create a user, or reset the password of an existing one when `reset` is set.
 * With no password given, a strong random one is generated.
 */
export async function createOrResetUser(
  db: Database,
  input: { username: string; displayName?: string; password?: string; reset?: boolean; now: number; argon2: Argon2Options },
): Promise<CreateUserResult> {
  const username = usernameSchema.parse(input.username).toLowerCase();
  const checked = passwordSchema.safeParse(input.password ?? generatePassword(20));
  if (!checked.success) throw new Error(`Password rejected: ${checked.error.issues[0]!.message}`);
  const password = checked.data;
  const hash = await hashPassword(password, input.argon2);
  const existing = findUserByUsername(db, username);
  if (existing) {
    if (!input.reset) throw new Error(`User "${username}" already exists (use --reset to set a new password)`);
    updatePassword(db, existing.id, hash);
    deleteUserSessions(db, existing.id);
    return { username, password, created: false };
  }
  const displayName = (input.displayName ?? username[0]!.toUpperCase() + username.slice(1)).trim().slice(0, 40);
  createUser(db, { username, displayName, passwordHash: hash, now: input.now });
  return { username, password, created: true };
}

/** Parse `<username> [--name "Display"] [--password X] [--reset]`. */
export function parseArgs(argv: string[]): { username?: string; displayName?: string; password?: string; reset: boolean } {
  const out: { username?: string; displayName?: string; password?: string; reset: boolean } = { reset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--reset") out.reset = true;
    else if (a === "--name") out.displayName = argv[++i];
    else if (a === "--password") out.password = argv[++i];
    else if (!a.startsWith("--") && !out.username) out.username = a;
  }
  return out;
}
