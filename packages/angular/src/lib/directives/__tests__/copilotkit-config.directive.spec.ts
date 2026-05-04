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
    expect(fixture.componentInstance.config.headers).toBe(headers);
  });

  it("does not throw when license key is missing and logs watermark warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => {
      TestBed.configureTestingModule({
        providers: [provideCopilotKit({ runtimeUrl: "https://example.com" })],
      });
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
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
