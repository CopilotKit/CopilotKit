import { describe, expect, it } from "vitest";
import { parseAttachmentUrl, isPublicAddress } from "./attachment-url.js";

describe("attachment URL policy", () => {
  it.each([
    "https://contoso.sharepoint.com/file?download=1",
    "https://graph.microsoft.com/v1.0/shares/id/driveItem/content",
    "https://smba.trafficmanager.net/amer/v3/attachments/id",
    "https://eu-api.asm.skype.com/v1/objects/id/views/original",
    "https://b0mpua-by3301.files.1drv.com/preauthenticated",
    "https://download.svc.ms/file",
    "https://files.teams.microsoft.com/file",
  ])("allows the Microsoft file host %s", (url) => {
    expect(parseAttachmentUrl(url).href).toBe(new URL(url).href);
  });
  it.each([
    "http://contoso.sharepoint.com/file",
    "https://attacker.example/file",
    "https://contoso.sharepoint.com.attacker.example/file",
    "https://evilsharepoint.com/file",
    "https://contoso.sharepoint.com:8443/file",
    "https://user:secret@contoso.sharepoint.com/file",
    "https://127.0.0.1/file",
    "https://2130706433/file",
    "https://0x7f000001/file",
    "https://[::1]/file",
    "https://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "ftp://contoso.sharepoint.com/file",
    "not a URL",
    "",
  ])("refuses %s", (url) => {
    expect(() => parseAttachmentUrl(url)).toThrow();
  });
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.100.100.200",
    "127.1.2.3",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "64:ff9b::a9fe:a9fe",
    "2002:a9fe:a9fe::",
    "2001::1",
    "2001:db8::1",
    "3fff::1",
    "garbage",
  ])("rejects nonpublic or transition address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each([
    "8.8.8.8",
    "13.107.136.9",
    "20.190.128.1",
    "2603:1030:20e:3::23",
    "2a01:111:f403::1",
  ])("allows public address %s", (address) =>
    expect(isPublicAddress(address)).toBe(true),
  );
});
