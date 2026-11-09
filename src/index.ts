import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { jsonLogger } from "./lib/logger";
import { lanUrls } from "./lib/network";
import { purgeExpiredSessions } from "./repo/sessions";

const dbPath = process.env.DATABASE_PATH ?? "data/tandem.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });

const config = loadConfig();
const db = openDatabase(dbPath);
const logger = jsonLogger();
const app = createApp({ db, config, logger, now: Date.now });

setInterval(() => purgeExpiredSessions(db, Date.now()), 60 * 60 * 1000).unref();

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";
Bun.serve({ port, hostname, fetch: app.fetch });

logger.log("info", "server_started", { hostname, port, cookieSecure: config.cookieSecure, hsts: config.hsts });
console.log(`\n  Tandem is running:\n    Local:   http://localhost:${port}`);
for (const url of lanUrls(hostname, port)) console.log(`    Network: ${url}`);
console.log("");
