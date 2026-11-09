import { Hono } from "hono";
import type { AppEnv } from "../context";
import { hashPassword } from "../auth/password";
import { changePasswordSchema } from "../lib/validation";
import { deleteOtherSessions } from "../repo/sessions";
import { updatePassword } from "../repo/users";

/** Account settings for the signed-in user. Mounted behind `requireAuth`. */
export function accountRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post("/account/password", async (c) => {
    const { db, config, logger } = c.get("deps");
    const user = c.get("user")!;
    const session = c.get("session")!;
    const parsed = changePasswordSchema.safeParse(await c.req.parseBody());
    if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? "Invalid password.", 400);

    updatePassword(db, user.id, await hashPassword(parsed.data.password, config.argon2));
    // Keep this session (its CSRF token is on the open page); every other device signs in again.
    const revoked = deleteOtherSessions(db, user.id, session.id_hash);
    logger.log("info", "password_changed", { userId: user.id, revokedSessions: revoked });

    return c.req.header("hx-request") === "true" ? c.body(null, 204) : c.redirect("/", 303);
  });

  return r;
}
