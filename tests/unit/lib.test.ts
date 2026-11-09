import { describe, expect, test } from "bun:test";
import { generatePassword, randomToken, safeEqual, sha256 } from "../../src/lib/crypto";
import { daysBetween, dueLabel, isoDate } from "../../src/lib/dates";
import { jsonLogger, silentLogger } from "../../src/lib/logger";
import {
  idSchema, listNameSchema, loginSchema, newItemSchema, passwordSchema, pick, safeRedirect, TABS, usernameSchema,
} from "../../src/lib/validation";
import { loadConfig } from "../../src/config";

describe("crypto", () => {
  test("randomToken is url-safe, 256-bit and unique", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(randomToken(16)).toHaveLength(22);
  });
  test("sha256 hex digest", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  test("generatePassword length, alphabet, entropy", () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(20);
    expect(pw).not.toMatch(/[0O1lI]/);
    expect(generatePassword(64)).toHaveLength(64);
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });
});

describe("dates", () => {
  const today = new Date(2026, 10, 8, 15, 30); // Sun 8 Nov 2026
  test("isoDate pads", () => expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05"));
  test("daysBetween ignores time of day", () => {
    expect(daysBetween(today, "2026-11-08")).toBe(0);
    expect(daysBetween(today, "2026-11-10")).toBe(2);
    expect(daysBetween(today, "2026-11-01")).toBe(-7);
  });
  test.each([
    ["2026-11-08", "Today", false],
    ["2026-11-09", "Tomorrow", false],
    ["2026-11-07", "Yesterday", true],
    ["2026-11-13", "Fri", false],
    ["2026-11-14", "Sat", false],
    ["2026-11-15", "15 Nov", false],
    ["2026-11-03", "3 Nov", true],
  ])("dueLabel(%s) = %s", (iso, label, overdue) => {
    expect(dueLabel(today, iso)).toEqual({ label, overdue });
  });
});

describe("logger", () => {
  test("json lines, sanitized against log injection", () => {
    const lines: string[] = [];
    const log = jsonLogger((l) => lines.push(l));
    log.log("warn", "login_failed", { username: "evil\r\n{\"forged\":1}", n: 3, long: "x".repeat(500) });
    log.log("info", "bare");
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: "warn", event: "login_failed", n: 3 });
    expect(entry.username).not.toMatch(/[\r\n]/);
    expect(entry.long).toHaveLength(200);
    expect(typeof entry.ts).toBe("string");
    expect(JSON.parse(lines[1]!).event).toBe("bare");
  });
  test("default writer uses console.log", () => {
    const orig = console.log;
    const seen: string[] = [];
    console.log = (l: string) => seen.push(l);
    try {
      jsonLogger().log("info", "x");
    } finally {
      console.log = orig;
    }
    expect(seen).toHaveLength(1);
  });
  test("silent logger", () => expect(silentLogger.log("info", "x")).toBeUndefined());
});

describe("validation", () => {
  test("login", () => {
    expect(loginSchema.safeParse({ username: " alice ", password: "x", remember: "on" }).data).toEqual({
      username: "alice", password: "x", remember: "on",
    });
    expect(loginSchema.safeParse({ username: "", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ username: "a", password: "x".repeat(257) }).success).toBe(false);
  });
  test("list names are cleaned and bounded", () => {
    expect(listNameSchema.parse({ name: "  Groceries\n\t list " }).name).toBe("Groceries list");
    expect(listNameSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(listNameSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  test("new item with optional due date", () => {
    expect(newItemSchema.parse({ title: "Milk" })).toEqual({ title: "Milk", due: null });
    expect(newItemSchema.parse({ title: "Milk", due: "" }).due).toBeNull();
    expect(newItemSchema.parse({ title: "Milk", due: "2026-11-09" }).due).toBe("2026-11-09");
    expect(newItemSchema.safeParse({ title: "Milk", due: "tomorrow" }).success).toBe(false);
    expect(newItemSchema.safeParse({ title: "x".repeat(201) }).success).toBe(false);
  });
  test("username and password policy", () => {
    expect(usernameSchema.safeParse("alice").success).toBe(true);
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("bad name").success).toBe(false);
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("x".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });
  test("ids", () => {
    expect(idSchema.parse("42")).toBe(42);
    for (const bad of ["0", "-1", "1.5", "abc", "1e400"]) expect(idSchema.safeParse(bad).success).toBe(false);
  });
  test("pick", () => {
    expect(pick(TABS, "done", "todo")).toBe("done");
    expect(pick(TABS, "nope", "todo")).toBe("todo");
    expect(pick(TABS, undefined, "todo")).toBe("todo");
  });
  test("safeRedirect blocks open redirects", () => {
    expect(safeRedirect("/lists/1?tab=done")).toBe("/lists/1?tab=done");
    for (const bad of [undefined, "", "https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/a\nb"])
      expect(safeRedirect(bad)).toBe("/");
    expect(safeRedirect("//x", "/login")).toBe("/login");
  });
});

describe("config", () => {
  test("production defaults are secure", () => {
    const c = loadConfig({});
    expect(c.cookieSecure).toBe(true);
    expect(c.hsts).toBe(true);
    expect(c.trustProxy).toBe(false);
    expect(c.argon2.memoryCost).toBeGreaterThanOrEqual(19_456);
  });
  test("development relaxes cookies only", () => {
    const c = loadConfig({ NODE_ENV: "development" });
    expect(c.cookieSecure).toBe(false);
    expect(c.hsts).toBe(false);
  });
  test("explicit overrides", () => {
    const c = loadConfig({ COOKIE_SECURE: "false", HSTS: "1", TRUST_PROXY: "true", ALLOWED_ORIGINS: " https://a.test, ,https://b.test" });
    expect(c).toMatchObject({ cookieSecure: false, hsts: true, trustProxy: true, allowedOrigins: ["https://a.test", "https://b.test"] });
  });
  test("defaults to process.env", () => expect(loadConfig().cookieSecure).toBe(false)); // NODE_ENV=test
});
