/** Runtime configuration. Secure defaults; development relaxes only what plain-HTTP testing needs. */
export interface Config {
  /** Send cookies with the Secure flag and the __Host- prefix. */
  cookieSecure: boolean;
  /** Send Strict-Transport-Security. */
  hsts: boolean;
  /** Trust X-Forwarded-For for the client IP (only behind a reverse proxy you control). */
  trustProxy: boolean;
  /** Extra origins allowed to POST (e.g. the public URL behind a proxy). */
  allowedOrigins: string[];
  session: {
    /** Idle timeout for a regular (browser-session) login. */
    idleMs: number;
    /** Absolute lifetime for a regular login. */
    absoluteMs: number;
    /** Idle timeout for "keep me signed in". */
    persistentIdleMs: number;
    /** Absolute lifetime for "keep me signed in". */
    persistentAbsoluteMs: number;
  };
  login: {
    /** Consecutive failures before the account is temporarily locked. */
    maxFailures: number;
    lockoutMs: number;
    /** Failed attempts allowed per client IP before it is blocked. */
    ipMaxFailures: number;
    /** How long an IP stays blocked after `ipMaxFailures` failures. */
    ipBlockMs: number;
    /** Failures older than this no longer count towards a block. */
    ipFailureWindowMs: number;
  };
  /** argon2id parameters (OWASP: m=19 MiB, t=2, p=1 minimum). */
  argon2: { memoryCost: number; timeCost: number };
  /** Maximum accepted request body in bytes. */
  bodyLimit: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dev = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  const bool = (v: string | undefined, fallback: boolean) =>
    v === undefined || v === "" ? fallback : v === "true" || v === "1";
  const cookieSecure = bool(env.COOKIE_SECURE, !dev);
  return {
    cookieSecure,
    hsts: bool(env.HSTS, cookieSecure),
    trustProxy: bool(env.TRUST_PROXY, false),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    session: {
      idleMs: 2 * HOUR,
      absoluteMs: 12 * HOUR,
      persistentIdleMs: 7 * DAY,
      persistentAbsoluteMs: 30 * DAY,
    },
    login: {
      maxFailures: 5,
      lockoutMs: 15 * MINUTE,
      ipMaxFailures: 3,
      ipBlockMs: 2 * MINUTE,
      ipFailureWindowMs: 15 * MINUTE,
    },
    argon2: { memoryCost: 19_456, timeCost: 2 },
    bodyLimit: 16 * 1024,
  };
}
