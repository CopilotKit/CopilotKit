import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    // `provideCopilotKit` no longer merges the public-key default into
    // `headers` itself (that would need a runtime `@copilotkit/core` import,
    // which regressed the Angular showcase's initial bundle, #1937). The
    // merge now happens in `copilotkit.ts`, where `CopilotKitCore` is
    // constructed; `injectCopilotKitConfig().headers` stays the caller's own
    // object, unmodified.
    expect(fixture.componentInstance.config.headers).toBe(headers);
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

  // Regression guard for #1937's bundle-size fix: `config.ts` sits on the
  // Angular app's startup graph (`provideCopilotKit` is called directly from
  // `app.config.ts`), so a VALUE import of `@copilotkit/core` here eagerly
  // pulls the whole core dist — and its own dependencies (`@ag-ui/client`,
  // `@ag-ui/proto`, phoenix, `zod-to-json-schema`, `@ag-ui/core`,
  // `fast-json-patch`, `@bufbuild/protobuf`) — into the INITIAL bundle chunk
  // instead of a lazy one. Every `@copilotkit/core` import in this file must
  // stay `import type`; the public-key header default is wrapped in
  // `copilotkit.ts` instead, which already imports core at runtime.
  it("imports @copilotkit/core as types only, never values", () => {
    const source = readFileSync(resolve(__dirname, "../../config.ts"), "utf8");
    // Anchored to the start of a line: an unanchored scan can start matching
    // inside a `//` comment that happens to contain the word "import" (this
    // file's own explanatory comment above does), and run on to swallow the
    // real import statement that follows it.
    const coreImportStatements = source.match(
      /^import\s[^;]*from\s+"@copilotkit\/core";/gm,
    );

    expect(coreImportStatements).not.toBeNull();
    expect(coreImportStatements!.length).toBeGreaterThan(0);
    for (const statement of coreImportStatements!) {
      expect(statement.startsWith("import type ")).toBe(true);
    }
  });
});
