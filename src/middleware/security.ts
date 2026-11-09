import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { csrf as originCheck } from "hono/csrf";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../context";
import { cookieNames } from "../context";
import { randomToken, safeEqual } from "../lib/crypto";

/** Strict security headers (OWASP Secure Headers Project). Everything is served same-origin. */
export function securityHeaders(hsts: boolean): MiddlewareHandler<AppEnv> {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      objectSrc: ["'none'"],
      manifestSrc: ["'self'"],
    },
    strictTransportSecurity: hsts ? "max-age=63072000; includeSubDomains" : false,
    // Not "no-referrer": with it browsers send `Origin: null` on form posts, and on plain-HTTP
    // origins (e.g. a LAN IP) there is no Sec-Fetch-Site either, so same-origin posts look forged.
    // "same-origin" still sends nothing to other sites.
    referrerPolicy: "same-origin",
    xFrameOptions: "DENY",
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    crossOriginEmbedderPolicy: "require-corp",
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
    },
  });
}

/** Reject cross-origin form posts (Origin / Sec-Fetch-Site check). */
export function sameOrigin(extra: string[]): MiddlewareHandler<AppEnv> {
  const check = originCheck({
    origin: (origin, c) => origin === new URL(c.req.url).origin || extra.includes(origin),
  });
  return async (c, next) => {
    let passed = false;
    try {
      await check(c, async () => {
        passed = true;
        await next();
      });
    } catch (err) {
      if (!passed) {
        c.get("deps").logger.log("warn", "origin_rejected", {
          path: c.req.path,
          origin: c.req.header("origin") ?? "(none)",
          secFetchSite: c.req.header("sec-fetch-site") ?? "(none)",
          host: c.req.header("host") ?? "(none)",
        });
      }
      throw err;
    }
  };
}

const UNSAFE = /^(POST|PUT|PATCH|DELETE)$/;

/**
 * Synchronizer-token CSRF defence. Authenticated requests use the token bound to the
 * session; anonymous ones (the login form) use a double-submit cookie.
 * Must run after the session loader and after the body was parsed into `form`.
 */
export const csrfToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { config } = c.get("deps");
  const names = cookieNames(config.cookieSecure);
  const session = c.get("session");
  let expected: string;
  if (session) {
    expected = session.csrf_token;
  } else {
    expected = getCookie(c, names.csrf) ?? "";
    if (!expected) {
      expected = randomToken();
      setCookie(c, names.csrf, expected, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "Strict",
        path: "/",
      });
    }
  }
  c.set("csrf", expected);

  if (UNSAFE.test(c.req.method)) {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const sent = typeof body._csrf === "string" ? body._csrf : (c.req.header("x-csrf-token") ?? "");
    if (!expected || !sent || !safeEqual(sent, expected)) {
      c.get("deps").logger.log("warn", "csrf_rejected", { path: c.req.path });
      return c.text("Invalid or missing CSRF token", 403);
    }
  }
  await next();
};

/** Authenticated pages must never be cached by browsers or proxies. */
export const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
};
