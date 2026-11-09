import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createOrResetUser, parseArgs } from "../src/cli/create-user";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db/database";

const args = parseArgs(process.argv.slice(2));
if (!args.username) {
  console.error('Usage: bun run user:create <username> [--name "Display Name"] [--password <pw>] [--reset]');
  process.exit(1);
}
const dbPath = process.env.DATABASE_PATH ?? "data/tandem.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath);
try {
  const r = await createOrResetUser(db, { ...args, username: args.username, now: Date.now(), argon2: loadConfig().argon2 });
  console.log(`${r.created ? "Created" : "Password reset for"} user "${r.username}"`);
  console.log(`Password: ${r.password}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
} finally {
  db.close();
}
