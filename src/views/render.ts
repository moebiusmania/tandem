import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../context";

/** Render a JSX page as a full HTML document. */
export async function render(c: Context<AppEnv>, node: { toString(): string | Promise<string> }, status: ContentfulStatusCode = 200) {
  return c.html(`<!doctype html>${await node.toString()}`, status);
}
