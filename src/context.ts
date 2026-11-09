import type { Database } from "bun:sqlite";
import type { Config } from "./config";
import type { Logger } from "./lib/logger";
import type { Session } from "./repo/sessions";
import type { User } from "./repo/users";

export interface Deps {
  db: Database;
  config: Config;
  logger: Logger;
  /** Current time in ms; injectable for tests. */
  now: () => number;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    user: User | null;
    session: Session | null;
    /** CSRF token to embed in forms rendered for this request. */
    csrf: string;
    theme: "dark" | "light";
  };
};

export function cookieNames(secure: boolean) {
  const p = secure ? "__Host-" : "";
  return { session: `${p}tandem_sid`, csrf: `${p}tandem_csrf`, theme: "tandem_theme" };
}
