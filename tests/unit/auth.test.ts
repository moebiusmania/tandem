import { describe, expect, test } from "bun:test";
import { dummyHash, hashPassword, verifyPassword } from "../../src/auth/password";
import { humanDuration, LoginThrottle } from "../../src/auth/throttle";
import { FAST_ARGON } from "../helpers";

describe("password", () => {
  test("argon2id hash and verify", async () => {
    const h = await hashPassword("correct horse battery", FAST_ARGON);
    expect(h).toStartWith("$argon2id$");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  test("malformed hash verifies false instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
  test("dummy hash is computed once", async () => {
    const d = dummyHash(FAST_ARGON);
    expect(await d()).toBe(await d());
  });
});

describe("LoginThrottle", () => {
  test("blocks after 3 consecutive failures for the block period", () => {
    const t = new LoginThrottle(3, 120_000, 900_000);
    expect(t.fail("ip", 0)).toEqual({ remaining: 2, blockedMs: 0 });
    expect(t.fail("ip", 1)).toEqual({ remaining: 1, blockedMs: 0 });
    expect(t.blockedFor("ip", 1)).toBe(0);
    expect(t.fail("ip", 2)).toEqual({ remaining: 0, blockedMs: 120_000 });
    expect(t.blockedFor("ip", 2)).toBe(120_000);
    expect(t.blockedFor("ip", 120_001)).toBe(1);
    expect(t.blockedFor("other", 2)).toBe(0);
    // block over: a fresh set of 3 attempts
    expect(t.blockedFor("ip", 120_002)).toBe(0);
    expect(t.fail("ip", 120_002)).toEqual({ remaining: 2, blockedMs: 0 });
  });
  test("success clears the failures", () => {
    const t = new LoginThrottle(3, 1000, 10_000);
    t.fail("ip", 0);
    t.fail("ip", 0);
    t.succeed("ip");
    expect(t.fail("ip", 0).remaining).toBe(2);
  });
  test("failures older than the window are forgotten", () => {
    const t = new LoginThrottle(3, 1000, 10_000);
    t.fail("ip", 0);
    t.fail("ip", 1);
    expect(t.fail("ip", 10_001)).toEqual({ remaining: 2, blockedMs: 0 });
  });
  test("memory is bounded", () => {
    const t = new LoginThrottle(3, 100, 1000, 3);
    t.fail("a", 0);
    t.fail("b", 0);
    t.fail("c", 500);
    t.fail("d", 1200); // a and b are stale -> pruned
    expect(t.fail("a", 1200).remaining).toBe(2);
    t.fail("c", 1200);
    t.fail("c", 1200); // c blocked until 1300; keys in insertion order: c, d, a
    expect(t.blockedFor("c", 1250)).toBe(50);
    t.fail("e", 1250); // full of live keys -> the oldest-inserted (c) is evicted
    expect(t.blockedFor("c", 1250)).toBe(0);
    expect(t.fail("d", 1250).remaining).toBe(1); // d kept its earlier failure
  });
});

describe("humanDuration", () => {
  test.each([
    [1, "1 second"],
    [45_000, "45 seconds"],
    [60_000, "1 minute"],
    [61_000, "2 minutes"],
    [120_000, "2 minutes"],
  ])("%d ms -> %s", (ms, text) => expect(humanDuration(ms)).toBe(text));
});
