import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "hono/bun";
import type { AppEnv } from "../context";
import { cookieNames } from "../context";
import { dummyHash, verifyPassword } from "../auth/password";
import { humanDuration, LoginThrottle } from "../auth/throttle";
import { setSessionCookie } from "../middleware/auth";
import { loginSchema, safeRedirect } from "../lib/validation";
import { createSession, deleteSession } from "../repo/sessions";
import { findUserByUsername, isLocked, listUsers, recordFailedLogin, resetFailedLogins } from "../repo/users";
import { LoginPage } from "../views/login";
import { render } from "../views/render";

const GENERIC_ERROR = "Incorrect username or password.";

export function clientIp(c: Context<AppEnv>): string {
  const { config } = c.get("deps");
  if (config.trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function authRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  let throttle: LoginThrottle | undefined;
  let dummy: (() => Promise<string>) | undefined;

  const page = (c: Context<AppEnv>, status: 200 | 400 | 401 | 429, extra: { error?: string; username?: string; remember?: boolean } = {}) =>
    render(
      c,
      <LoginPage
        csrf={c.get("csrf")}
        theme={c.get("theme")}
        accounts={listUsers(c.get("deps").db).length}
        {...extra}
      />,
      status,
    );

  r.get("/login", async (c) => (c.get("user") ? c.redirect("/", 303) : page(c, 200)));

  r.post("/login", async (c) => {
    const { db, config, logger, now } = c.get("deps");
    const { ipMaxFailures, ipBlockMs, ipFailureWindowMs } = config.login;
    throttle ??= new LoginThrottle(ipMaxFailures, ipBlockMs, ipFailureWindowMs);
    dummy ??= dummyHash(config.argon2);
    const ip = clientIp(c);
    const t = now();

    const blocked = (ms: number, extra: { username?: string; remember?: boolean } = {}) => {
      c.header("Retry-After", String(Math.ceil(ms / 1000)));
      return page(c, 429, { ...extra, error: `Too many failed sign-in attempts. Try again in ${humanDuration(ms)}.` });
    };

    // A blocked IP gets no password check at all, even for the right password.
    const wait = throttle.blockedFor(ip, t);
    if (wait > 0) {
      logger.log("warn", "login_blocked_ip", { ip, retryAfterMs: wait });
      return blocked(wait);
    }

    /** Count a failure against the IP; the attempt that reaches the limit starts the block. */
    const fail = (status: 400 | 401, reason: string, extra: { username?: string; remember?: boolean } = {}) => {
      const { remaining, blockedMs } = throttle!.fail(ip, t);
      logger.log("warn", "login_failed", { ip, username: extra.username, reason, remaining });
      if (blockedMs) {
        logger.log("warn", "ip_blocked", { ip, blockMs: blockedMs, failures: ipMaxFailures });
        return blocked(blockedMs, extra);
      }
      const left = `${remaining} attempt${remaining === 1 ? "" : "s"} left before sign-in is paused for ${humanDuration(ipBlockMs)}.`;
      return page(c, status, { ...extra, error: `${GENERIC_ERROR} ${left}` });
    };

    const parsed = loginSchema.safeParse(await c.req.parseBody());
    if (!parsed.success) return fail(400, "invalid_input");
    const { username, password, remember } = parsed.data;
    const back = { username, remember: !!remember };

    const user = findUserByUsername(db, username);
    if (!user) {
      await verifyPassword(password, await dummy());
      return fail(401, "unknown_user", back);
    }
    if (isLocked(user, t)) {
      // Same message as a bad password: do not reveal that the account exists or is locked.
      await verifyPassword(password, await dummy());
      return fail(401, "locked", back);
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      const { locked } = recordFailedLogin(db, user.id, { now: t, ...config.login });
      if (locked) logger.log("warn", "account_locked", { ip, username });
      return fail(401, "bad_password", back);
    }

    throttle.succeed(ip);
    resetFailedLogins(db, user.id);
    // Session fixation: drop any session presented with this request and always issue a new id.
    const old = c.get("session");
    if (old) deleteSession(db, old.id_hash);
    const { token } = createSession(db, { userId: user.id, persistent: !!remember, now: t, policy: config.session });
    setSessionCookie(c, token, !!remember);
    deleteCookie(c, cookieNames(config.cookieSecure).csrf, { path: "/", secure: config.cookieSecure });
    logger.log("info", "login_success", { ip, userId: user.id });
    return c.redirect("/", 303);
  });

  r.post("/logout", (c) => {
    const { db, config, logger } = c.get("deps");
    const session = c.get("session");
    if (session) {
      deleteSession(db, session.id_hash);
      logger.log("info", "logout", { userId: session.user_id });
    }
    deleteCookie(c, cookieNames(config.cookieSecure).session, { path: "/", secure: config.cookieSecure });
    c.header("Clear-Site-Data", '"cache", "storage"');
    return c.redirect("/login", 303);
  });

  r.post("/theme", async (c) => {
    const { config } = c.get("deps");
    const body = await c.req.parseBody();
    const theme = body.theme === "light" ? "light" : "dark";
    setCookie(c, cookieNames(config.cookieSecure).theme, theme, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: 365 * 24 * 3600,
    });
    return c.redirect(safeRedirect(typeof body.next === "string" ? body.next : undefined), 303);
  });

  return r;
}
