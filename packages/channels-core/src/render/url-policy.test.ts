import { describe, it, expect } from "vitest";
import { defaultAllowImageUrl } from "./url-policy.js";

describe("defaultAllowImageUrl", () => {
  it("allows public http(s) URLs", () => {
    expect(defaultAllowImageUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(defaultAllowImageUrl("http://example.com/a.png")).toBe(true);
    // A public IP literal is fine.
    expect(defaultAllowImageUrl("https://93.184.216.34/a.png")).toBe(true);
  });

  it("denies non-http(s) schemes", () => {
    expect(defaultAllowImageUrl("file:///etc/passwd")).toBe(false);
    expect(defaultAllowImageUrl("ftp://example.com/a.png")).toBe(false);
    expect(defaultAllowImageUrl("not a url")).toBe(false);
  });

  it("denies loopback and localhost-ish hosts", () => {
    for (const u of [
      "http://localhost/a.png",
      "http://LOCALHOST:3000/a.png",
      "http://api.localhost/a.png",
      "http://127.0.0.1/a.png",
      "http://127.1.2.3/a.png",
      "http://0.0.0.0/a.png",
      "http://[::1]/a.png",
      "http://printer.local/a.png",
    ])
      expect(defaultAllowImageUrl(u), u).toBe(false);
  });

  it("denies private, link-local and internal hosts (cloud metadata included)", () => {
    for (const u of [
      "http://169.254.169.254/latest/meta-data/", // AWS/Azure IMDS
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://10.0.0.5/a.png",
      "http://192.168.1.9/a.png",
      "http://172.16.0.1/a.png",
      "http://172.31.255.255/a.png",
      "http://100.64.0.1/a.png", // CGNAT
      "http://redis.svc.internal/a.png",
      "http://[fd00::1]/a.png",
      "http://[fe80::1]/a.png",
    ])
      expect(defaultAllowImageUrl(u), u).toBe(false);
  });

  it("does not over-block public hosts that merely start with a blocked prefix", () => {
    // 172.32.x is public (the private block ends at 172.31), and "localhostage.com"
    // is not "localhost".
    expect(defaultAllowImageUrl("http://172.32.0.1/a.png")).toBe(true);
    expect(defaultAllowImageUrl("http://localhostage.com/a.png")).toBe(true);
    expect(defaultAllowImageUrl("http://11.0.0.1/a.png")).toBe(true);
  });
});
