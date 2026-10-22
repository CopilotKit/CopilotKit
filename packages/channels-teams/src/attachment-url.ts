import { BlockList, isIP } from "node:net";

/** Deliberately separate from connector origins and their localhost exceptions. */
const EXACT_HOSTS = new Set([
  "graph.microsoft.com",
  "smba.trafficmanager.net",
  "smba.infra.gcc.teams.microsoft.com",
  "smba.infra.gov.teams.microsoft.us",
  "smba.infra.dod.teams.microsoft.us",
  "msteams.botframework.azure.cn",
]);

// SharePoint tenant URLs, Teams inline media, and preauthenticated Graph
// download destinations (Graph /content responds with a 302 to files.1drv.com).
// A Microsoft suffix alone is not an IP security boundary: every connection
// still requires public DNS answers, including tenant-controlled destinations.
const HOST_SUFFIXES = [
  "sharepoint.com",
  "sharepoint.us",
  "sharepoint.cn",
  "sharepoint.de",
  "teams.microsoft.com",
  "teams.microsoft.us",
  "asm.skype.com",
  "botframework.com",
  "botframework.azure.us",
  "files.1drv.com",
  "svc.ms",
] as const;

/** Safe, fixed messages only: this error may be shown to the agent or logged. */
export class AttachmentDownloadError extends Error {}

export function parseAttachmentUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AttachmentDownloadError("invalid attachment URL");
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !(
      EXACT_HOSTS.has(url.hostname) ||
      HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(`.${suffix}`))
    )
  ) {
    throw new AttachmentDownloadError(
      "attachment URL is not an allowed Microsoft HTTPS host",
    );
  }
  return url;
}

const nonPublicV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  nonPublicV4.addSubnet(address, prefix, "ipv4");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const nonPublicV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23], // Special-purpose space, including Teredo / ORCHID.
  ["2001:db8::", 32],
  ["2002::", 16], // Documentation and 6to4.
  ["3fff::", 20], // Documentation.
] as const)
  nonPublicV6.addSubnet(address, prefix, "ipv6");

/** Reject special-use addresses, including IPv4-mapped/NAT64 transition forms. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublicV4.check(address, "ipv4");
  if (family !== 6 || address.includes("%")) return false;
  return globalV6.check(address, "ipv6") && !nonPublicV6.check(address, "ipv6");
}
