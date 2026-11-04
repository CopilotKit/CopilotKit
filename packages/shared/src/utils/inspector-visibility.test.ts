import { describe, expect, it } from "vitest";
import { shouldEnableInspector } from "./inspector-visibility";

describe("shouldEnableInspector", () => {
  it("shows by default in a development browser", () => {
    expect(
      shouldEnableInspector({
        isBrowser: true,
        isDevelopment: true,
      }),
    ).toBe(true);
  });

  it("honors an explicit disable in development", () => {
    expect(
      shouldEnableInspector({
        enableInspector: false,
        isBrowser: true,
        isDevelopment: true,
      }),
    ).toBe(false);
  });

  it("never shows in production, even when explicitly enabled", () => {
    expect(
      shouldEnableInspector({
        enableInspector: true,
        isBrowser: true,
        isDevelopment: false,
      }),
    ).toBe(false);
  });

  it("never shows during server rendering", () => {
    expect(
      shouldEnableInspector({
        enableInspector: true,
        isBrowser: false,
        isDevelopment: true,
      }),
    ).toBe(false);
  });
});

describe("shouldEnableInspector hostname rule", () => {
  const developmentBrowser = { isBrowser: true, isDevelopment: true };

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "shows on the loopback host %s",
    (hostname) => {
      expect(shouldEnableInspector({ ...developmentBrowser, hostname })).toBe(
        true,
      );
    },
  );

  it.each(["192.168.1.20", "dev.example.com", "my-tunnel.ngrok.app"])(
    "hides on the remote host %s, even when explicitly enabled",
    (hostname) => {
      expect(
        shouldEnableInspector({
          ...developmentBrowser,
          enableInspector: true,
          hostname,
        }),
      ).toBe(false);
    },
  );
});
