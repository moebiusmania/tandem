import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Deps } from "./context";
import { loadSession, requireAuth } from "./middleware/auth";
import { csrfToken, noStore, sameOrigin, securityHeaders } from "./middleware/security";
import { accountRoutes } from "./routes/account";
import { authRoutes } from "./routes/auth";
import { listRoutes } from "./routes/lists";

export function createApp(deps: Deps, opts: { staticRoot?: string } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    // Never leak stack traces or internals to the client.
    deps.logger.log("error", "unhandled_error", { path: c.req.path, message: err.message });
    return c.text("Something went wrong.", 500);
  });
  app.notFound((c) => c.text("Not found", 404));

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.use("*", securityHeaders(deps.config.hsts));
  app.use(
    "*",
    bodyLimit({ maxSize: deps.config.bodyLimit, onError: (c) => c.text("Payload too large", 413) }),
  );

  app.use(
    "/static/*",
    async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=3600");
    },
    serveStatic({ root: opts.staticRoot ?? "./public", rewriteRequestPath: (p) => p.replace(/^\/static/, "") }),
  );

  // Browsers ask for /favicon.ico on their own; serve it without authentication.
  app.get(
    "/favicon.ico",
    async (c, next) => {
      await next();
      c.header("Cache-Control", "public, max-age=86400");
    },
    serveStatic({ root: opts.staticRoot ?? "./public", rewriteRequestPath: () => "/icons/favicon.ico" }),
  );

  // A missing asset is a plain 404, never a redirect to the login page.
  app.all("/static/*", (c) => c.notFound());
  app.get("/healthz", (c) => c.text("ok"));

  app.use("*", sameOrigin(deps.config.allowedOrigins));
  app.use("*", loadSession);
  app.use("*", csrfToken);
  app.use("*", noStore);

  app.route("/", authRoutes());

  app.use("*", requireAuth);
  app.route("/", accountRoutes());
  app.route("/", listRoutes());

  return app;
}
