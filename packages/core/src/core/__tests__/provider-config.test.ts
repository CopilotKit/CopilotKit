import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import {
  ɵCOPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  ɵCOPILOT_CLOUD_RUNTIME_URL,
  ɵpublicKeyHeaderDefaults,
  ɵreportProviderConfigDiagnostics,
  ɵresolveProviderConfig,
  ɵtoolRendererShapeChanged,
} from "../provider-config";
import type { ɵProviderConfigDiagnostic } from "../provider-config";

const CLOUD_URL = "https://api.cloud.copilotkit.ai/copilotkit/v1";
const KEY_HEADER = "X-CopilotCloud-Public-Api-Key";

function agent(agentId: string) {
  return new HttpAgent({ url: `https://agents.example/${agentId}`, agentId });
}

describe("ɵresolveProviderConfig", () => {
  it("exports the Copilot Cloud header name and URL", () => {
    expect(ɵCOPILOT_CLOUD_PUBLIC_API_KEY_HEADER).toBe(KEY_HEADER);
    expect(ɵCOPILOT_CLOUD_RUNTIME_URL).toBe(CLOUD_URL);
  });

  it("uses publicApiKey before publicLicenseKey", () => {
    const resolved = ɵresolveProviderConfig({
      publicApiKey: "api-key",
      publicLicenseKey: "license-key",
    });
    expect(resolved.publicKey).toBe("api-key");
    expect(resolved.headerDefaults).toEqual({ [KEY_HEADER]: "api-key" });
  });

  it("falls back to publicLicenseKey", () => {
    const resolved = ɵresolveProviderConfig({ publicLicenseKey: "license" });
    expect(resolved.publicKey).toBe("license");
    expect(resolved.headerDefaults).toEqual({ [KEY_HEADER]: "license" });
  });

  it("sends a key that does not match the ck_pub_ format", () => {
    const resolved = ɵresolveProviderConfig({ publicApiKey: "not-ck-pub" });
    expect(resolved.headerDefaults).toEqual({ [KEY_HEADER]: "not-ck-pub" });
  });

  it("uses Copilot Cloud when a key is set and no runtimeUrl is given", () => {
    expect(ɵresolveProviderConfig({ publicApiKey: "k" }).runtimeUrl).toBe(
      CLOUD_URL,
    );
  });

  it("keeps an explicit runtimeUrl over Copilot Cloud", () => {
    const resolved = ɵresolveProviderConfig({
      runtimeUrl: "/api/copilotkit",
      publicApiKey: "k",
    });
    expect(resolved.runtimeUrl).toBe("/api/copilotkit");
  });

  it("has no runtime URL and no header defaults without a key", () => {
    const resolved = ɵresolveProviderConfig({});
    expect(resolved.runtimeUrl).toBeUndefined();
    expect(resolved.headerDefaults).toEqual({});
  });

  it.each([
    [true, "single"],
    [false, "rest"],
    [undefined, "auto"],
  ] as const)("maps useSingleEndpoint %s to %s", (useSingleEndpoint, want) => {
    expect(
      ɵresolveProviderConfig({ runtimeUrl: "/r", useSingleEndpoint })
        .runtimeTransport,
    ).toBe(want);
  });

  it("prefers runtimeTransport over useSingleEndpoint", () => {
    const resolved = ɵresolveProviderConfig({
      runtimeUrl: "/r",
      runtimeTransport: "rest",
      useSingleEndpoint: true,
    });
    expect(resolved.runtimeTransport).toBe("rest");
  });

  it("puts selfManagedAgents on top of the dev agents", () => {
    const devA = agent("a");
    const devB = agent("b");
    const managedB = agent("b");
    const resolved = ɵresolveProviderConfig({
      agents__unsafe_dev_only: { a: devA, b: devB },
      selfManagedAgents: { b: managedB },
      publicApiKey: "k",
    });
    expect(resolved.agents).toEqual({ a: devA, b: managedB });
    expect(resolved.agents.b).toBe(managedB);
  });

  it("adds a2uiCatalogAvailable when a catalog is set", () => {
    const resolved = ɵresolveProviderConfig({
      runtimeUrl: "/r",
      properties: { tenant: "acme" },
      a2uiCatalog: { id: "catalog" },
    });
    expect(resolved.properties).toEqual({
      tenant: "acme",
      a2uiCatalogAvailable: true,
    });
  });

  it("returns the same properties object without a catalog", () => {
    const properties = { tenant: "acme" };
    const resolved = ɵresolveProviderConfig({
      runtimeUrl: "/r",
      properties,
      a2uiCatalog: null,
    });
    expect(resolved.properties).toBe(properties);
  });

  it("reports a missing runtime config as an error", () => {
    expect(ɵresolveProviderConfig({}).diagnostics).toEqual([
      {
        level: "error",
        code: "missing_runtime_config",
        message:
          "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'",
      },
    ]);
  });

  it.each([
    ["a runtimeUrl", { runtimeUrl: "/r" }],
    ["a key", { publicLicenseKey: "k" }],
    ["dev agents", { agents__unsafe_dev_only: { a: agent("a") } }],
  ])("has no diagnostics with %s", (_label, input) => {
    expect(ɵresolveProviderConfig(input).diagnostics).toEqual([]);
  });

  it("warns when selfManagedAgents is used without a key", () => {
    const resolved = ɵresolveProviderConfig({
      selfManagedAgents: { a: agent("a") },
    });
    expect(resolved.diagnostics).toEqual([
      {
        level: "warn",
        code: "self_managed_agents_without_license",
        message:
          "[CopilotKit] `selfManagedAgents` is part of CopilotKit's Enterprise Intelligence tier. Provide a `publicLicenseKey` for production use — contact the CopilotKit team about licensing.",
      },
    ]);
  });
});

describe("ɵpublicKeyHeaderDefaults", () => {
  it("returns the key header for a key", () => {
    expect(ɵpublicKeyHeaderDefaults("k")).toEqual({ [KEY_HEADER]: "k" });
  });

  it("returns no headers without a key", () => {
    expect(ɵpublicKeyHeaderDefaults(undefined)).toEqual({});
    expect(ɵpublicKeyHeaderDefaults("")).toEqual({});
  });
});

describe("ɵreportProviderConfigDiagnostics", () => {
  const missing: ɵProviderConfigDiagnostic = {
    level: "error",
    code: "missing_runtime_config",
    message: "missing",
  };
  const advisory: ɵProviderConfigDiagnostic = {
    level: "warn",
    code: "self_managed_agents_without_license",
    message: "advisory",
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws an error diagnostic in production", () => {
    expect(() =>
      ɵreportProviderConfigDiagnostics([missing], {
        isProduction: true,
        logged: new Set(),
      }),
    ).toThrow("missing");
  });

  it("warns for an error diagnostic outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ɵreportProviderConfigDiagnostics([missing], {
      isProduction: false,
      logged: new Set(),
    });
    expect(warn.mock.calls).toEqual([["missing"]]);
  });

  it("warns for a warn diagnostic in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ɵreportProviderConfigDiagnostics([advisory], {
      isProduction: true,
      logged: new Set(),
    });
    expect(warn.mock.calls).toEqual([["advisory"]]);
  });

  it("logs each message once per logged set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logged = new Set<string>();
    ɵreportProviderConfigDiagnostics([missing, advisory], {
      isProduction: false,
      logged,
    });
    ɵreportProviderConfigDiagnostics([missing], {
      isProduction: false,
      logged,
    });
    expect(warn.mock.calls).toEqual([["missing"], ["advisory"]]);
  });
});

describe("ɵtoolRendererShapeChanged", () => {
  it("is false for a new array with the same agentId:name pairs", () => {
    expect(
      ɵtoolRendererShapeChanged(
        [{ name: "a" }, { name: "b", agentId: "x" }],
        [{ name: "b", agentId: "x" }, { name: "a" }],
      ),
    ).toBe(false);
  });

  it("is true when a renderer is added", () => {
    expect(
      ɵtoolRendererShapeChanged(
        [{ name: "a" }],
        [{ name: "a" }, { name: "b" }],
      ),
    ).toBe(true);
  });

  it("is true when a renderer moves to another agent", () => {
    expect(
      ɵtoolRendererShapeChanged(
        [{ name: "a", agentId: "x" }],
        [{ name: "a", agentId: "y" }],
      ),
    ).toBe(true);
  });
});
