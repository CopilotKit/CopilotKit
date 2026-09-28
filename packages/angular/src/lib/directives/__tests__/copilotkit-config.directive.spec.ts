import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { provideCopilotKit, injectCopilotKitConfig } from "../../config";

describe("CopilotKit config", () => {
  beforeEach(() => {
    (globalThis as any).__copilotkitAngularLicenseWatermarkLogged = undefined;
    vi.restoreAllMocks();
  });

  it("provides configuration via DI", () => {
    @Component({ standalone: true, template: "" })
    class HostComponent {
      config = injectCopilotKitConfig();
    }

    const headers = {
      Authorization: "token",
      "X-CopilotCloud-Public-Api-Key": "ck_pub_" + "b".repeat(32),
    };

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          runtimeUrl: "https://example.com",
          headers,
          licenseKey: "ck_pub_" + "a".repeat(32),
        }),
      ],
    });

    const fixture = TestBed.createComponent(HostComponent);
    expect(fixture.componentInstance.config.runtimeUrl).toBe(
      "https://example.com",
    );
    // Not `toBe`: `ɵwithHeaderDefaults` (the shared helper `provideCopilotKit`
    // now delegates to, matching React/Vue) always returns a new object when
    // it has any defaults to fill in, even when every key was already
    // present. Content, not reference identity, is the contract here.
    expect(fixture.componentInstance.config.headers).toEqual(headers);
  });

  it("does not throw or warn when license key is missing (watermark disabled)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => {
      TestBed.configureTestingModule({
        providers: [provideCopilotKit({ runtimeUrl: "https://example.com" })],
      });
    }).not.toThrow();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not inject invalid license key into headers", () => {
    @Component({ standalone: true, template: "" })
    class HostComponent {
      config = injectCopilotKitConfig();
    }

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          runtimeUrl: "https://example.com",
          headers: { Authorization: "token" },
          licenseKey: "invalid-key",
        }),
      ],
    });

    const fixture = TestBed.createComponent(HostComponent);
    expect(fixture.componentInstance.config.headers).toEqual({
      Authorization: "token",
    });
  });
});
