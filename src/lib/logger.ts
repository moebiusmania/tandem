export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}

/** Strip CR/LF so attacker-controlled values cannot forge log lines (OWASP log injection). */
function sanitize(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").slice(0, 200) : value;
}

/** Structured JSON security/event log on stdout. Never pass secrets in `fields`. */
export function jsonLogger(write: (line: string) => void = (l) => console.log(l)): Logger {
  return {
    log(level, event, fields = {}) {
      const clean = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, sanitize(v)]));
      write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...clean }));
    },
  };
}

export const silentLogger: Logger = { log() {} };
