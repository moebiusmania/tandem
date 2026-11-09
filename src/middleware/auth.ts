import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../context";
import { cookieNames } from "../context";
import { validateSession } from "../repo/sessions";
import { findUserById } from "../repo/users";

/** Resolve the session cookie into `user` / `session` variables. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { db, config, now } = c.get("deps");
  const names = cookieNames(config.cookieSecure);
  const token = getCookie(c, names.session);
  c.set("user", null);
  c.set("session", null);
  if (token) {
    const session = validateSession(db, token, now(), config.session);
    const user = session ? findUserById(db, session.user_id) : null;
    if (session && user) {
      c.set("session", session);
      c.set("user", user);
    } else {
      deleteCookie(c, names.session, { path: "/", secure: config.cookieSecure });
    }
  }
  const theme = getCookie(c, names.theme);
  c.set("theme", theme === "light" ? "light" : "dark");
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) {
    if (c.req.method === "GET") return c.redirect("/login", 303);
    return c.text("Authentication required", 401);
  }
  await next();
};

export function setSessionCookie(c: Context<AppEnv>, token: string, persistent: boolean): void {
  const { config } = c.get("deps");
  setCookie(c, cookieNames(config.cookieSecure).session, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Strict",
    path: "/",
    ...(persistent ? { maxAge: Math.floor(config.session.persistentAbsoluteMs / 1000) } : {}),
  });
}
