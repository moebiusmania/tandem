import { expect, test } from "bun:test";
import { lanUrls } from "../../src/lib/network";

const iface = (address: string, family: "IPv4" | "IPv6", internal: boolean) =>
  ({ address, family, internal, netmask: "", mac: "", cidr: null }) as any;

test("lists external IPv4 addresses when bound to all interfaces", () => {
  const ifs = {
    lo: [iface("127.0.0.1", "IPv4", true)],
    wlan0: [iface("192.168.1.42", "IPv4", false), iface("fe80::1", "IPv6", false)],
    eth0: undefined,
  };
  expect(lanUrls("0.0.0.0", 3000, ifs)).toEqual(["http://192.168.1.42:3000"]);
  expect(lanUrls("::", 3000, ifs)).toEqual(["http://192.168.1.42:3000"]);
});
test("a specific host is returned as-is", () => {
  expect(lanUrls("10.0.0.5", 8080)).toEqual(["http://10.0.0.5:8080"]);
});
test("defaults to the machine's interfaces", () => {
  expect(Array.isArray(lanUrls("0.0.0.0", 1))).toBe(true);
});
