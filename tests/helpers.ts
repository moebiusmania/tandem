import type { Database } from "bun:sqlite";
import { createApp } from "../src/app";
import { loadConfig, type Config } from "../src/config";
import type { Deps } from "../src/context";
import { openDatabase } from "../src/db/database";
import { hashPassword } from "../src/auth/password";
import type { Logger, LogLevel } from "../src/lib/logger";
import { createUser, type User } from "../src/repo/users";

export const ORIGIN = "http://localhost";
export const FAST_ARGON = { memoryCost: 1024, timeCost: 1 };
export const T0 = new Date(2026, 10, 8, 10, 0, 0).getTime(); // Sunday 8 Nov 2026, 10:00 local

export interface LogEntry {
  level: LogLevel;
  event: string;
  fields: Record<string, unknown>;
}

export function captureLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { entries, log: (level, event, fields = {}) => entries.push({ level, event, fields }) };
}

export interface TestCtx {
  db: Database;
  config: Config;
  logger: ReturnType<typeof captureLogger>;
  clock: { t: number };
  app: ReturnType<typeof createApp>;
  deps: Deps;
}

export function setup(overrides: Partial<Config> = {}): TestCtx {
  const db = openDatabase(":memory:");
  const config = { ...loadConfig({ NODE_ENV: "test" }), argon2: FAST_ARGON, ...overrides };
  const logger = captureLogger();
  const clock = { t: T0 };
  const deps: Deps = { db, config, logger, now: () => clock.t };
  return { db, config, logger, clock, deps, app: createApp(deps) };
}

export async function addUser(db: Database, username: string, password: string, displayName?: string): Promise<User> {
  return createUser(db, {
    username,
    displayName: displayName ?? username[0]!.toUpperCase() + username.slice(1),
    passwordHash: await hashPassword(password, FAST_ARGON),
    now: T0,
  });
}

/** A tiny browser: keeps cookies, sends Origin, extracts CSRF tokens from pages. */
export class Client {
  cookies = new Map<string, string>();
  csrf = "";

  constructor(private ctx: TestCtx, private origin = ORIGIN) {}

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const idx = pair!.indexOf("=");
      const name = pair!.slice(0, idx);
      const value = pair!.slice(idx + 1);
      if (value === "" || /max-age=0/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    const res = await this.ctx.app.request(path, { headers: { cookie: this.cookieHeader(), ...headers } });
    this.absorb(res);
    if ((res.headers.get("content-type") ?? "").includes("text/html")) {
      const html = await res.clone().text();
      const m = html.match(/name="_csrf" value="([^"]+)"/);
      if (m) this.csrf = m[1]!;
    }
    return res;
  }

  async post(
    path: string,
    form: Record<string, string> = {},
    opts: { csrf?: string | null; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const body = new URLSearchParams(form);
    const token = opts.csrf === undefined ? this.csrf : opts.csrf;
    if (token !== null) body.set("_csrf", token);
    const res = await this.ctx.app.request(path, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: this.origin,
        cookie: this.cookieHeader(),
        ...opts.headers,
      },
    });
    this.absorb(res);
    return res;
  }

  async login(username: string, password: string, remember = true): Promise<Response> {
    await this.get("/login");
    const res = await this.post("/login", { username, password, ...(remember ? { remember: "on" } : {}) });
    if (res.status === 303) await this.get("/");
    return res;
  }
}

export async function loggedIn(ctx: TestCtx, username = "alice", password = "correct horse battery") {
  const user = await addUser(ctx.db, username, password);
  const client = new Client(ctx);
  const res = await client.login(username, password);
  if (res.status !== 303) throw new Error(`login failed: ${res.status}`);
  return { user, client };
}
