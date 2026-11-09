import type { Context } from "hono";
import { jsx } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../context";
import { PublicOrigin } from "./layout";

/** Render a JSX page as a full HTML document. */
export async function render(c: Context<AppEnv>, node: { toString(): string | Promise<string> }, status: ContentfulStatusCode = 200) {
  // Behind a TLS-terminating proxy the request URL is plain HTTP, so prefer the configured public origin.
  const origin = c.get("deps").config.allowedOrigins[0] ?? new URL(c.req.url).origin;
  const page = jsx(PublicOrigin.Provider, { value: origin }, node as never);
  return c.html(`<!doctype html>${await page.toString()}`, status);
}
