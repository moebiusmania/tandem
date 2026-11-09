import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

/** URLs at which a server bound to `hostname` can be reached from other devices on the LAN. */
export function lanUrls(
  hostname: string,
  port: number,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  if (hostname !== "0.0.0.0" && hostname !== "::") return [`http://${hostname}:${port}`];
  return Object.values(interfaces)
    .flat()
    .filter((i): i is NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
}
