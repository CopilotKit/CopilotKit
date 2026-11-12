import { PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { HttpAgent } from "@ag-ui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKit } from "./copilotkit";
import { provideCopilotKit } from "./config";
import type { CopilotKitConfig } from "./config";

const CLOUD_URL = "https://api.cloud.copilotkit.ai/copilotkit/v1";
const KEY_HEADER = "X-CopilotCloud-Public-Api-Key";
const MISSING_CONFIG =
  "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'";

let fetchMock: ReturnType<typeof vi.fn>;

function injectCopilotKit(
  config: CopilotKitConfig,
  platform: "browser" | "server" = "browser",
) {
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit(config),
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  return TestBed.inject(CopilotKit);
}

const infoCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/info"));

function agent(agentId: string) {
  return new HttpAgent({ url: `https://agents.example/${agentId}`, agentId });
}

describe("CopilotKit provider config", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    fetchMock = vi.fn(async () => {
      throw new Error("network failure");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses Copilot Cloud when only a license key is set", () => {
    const copilotKit = injectCopilotKit({ licenseKey: "ck_pub_test" });
    expect(copilotKit.core.runtimeUrl).toBe(CLOUD_URL);
    expect(copilotKit.runtimeUrl()).toBe(CLOUD_URL);
  });

  it("sends a license key that is not in the ck_pub_ format", () => {
    const copilotKit = injectCopilotKit({
      runtimeUrl: "/api/copilotkit",
      licenseKey: "not-a-ck-pub-key",
    });
    expect(copilotKit.core.headers).toEqual({
      [KEY_HEADER]: "not-a-ck-pub-key",
    });
  });

  it("warns once about a missing runtime config in dev mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    injectCopilotKit({});
    const missing = warn.mock.calls.filter(
      ([message]) => message === MISSING_CONFIG,
    );
    expect(missing).toHaveLength(1);
  });

  it("applies runtimeTransport, debug and defaultThrottleMs at startup", () => {
    const copilotKit = injectCopilotKit({
      runtimeUrl: "/api/copilotkit",
      runtimeTransport: "single",
      debug: true,
      defaultThrottleMs: 40,
    });
    expect(copilotKit.core.runtimeTransport).toBe("single");
    expect(copilotKit.runtimeTransport()).toBe("single");
    expect(copilotKit.core.debug).toBe(true);
    expect(copilotKit.core.defaultThrottleMs).toBe(40);
  });

  it("calls the onError option for core errors", async () => {
    const onError = vi.fn();
    const copilotKit = injectCopilotKit({
      runtimeUrl: "/api/copilotkit",
      onError,
    });
    copilotKit.updateRuntime({ defaultThrottleMs: -1 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(copilotKit.core.defaultThrottleMs).toBeUndefined();
  });

  it("clears the runtime URL when updateRuntime passes undefined", () => {
    const copilotKit = injectCopilotKit({
      runtimeUrl: "/api/copilotkit",
      agents: { a: agent("a") },
    });
    copilotKit.updateRuntime({ runtimeUrl: undefined });
    expect(copilotKit.core.runtimeUrl).toBeUndefined();
    expect(copilotKit.runtimeUrl()).toBeUndefined();
  });

  it("keeps the last agents when only selfManagedAgents changes", () => {
    const first = agent("first");
    const managed = agent("managed");
    const copilotKit = injectCopilotKit({
      runtimeUrl: "/api/copilotkit",
      licenseKey: "ck_pub_test",
    });
    copilotKit.updateRuntime({ agents: { first } });
    copilotKit.updateRuntime({ selfManagedAgents: { managed } });
    expect(copilotKit.core.agents).toEqual({ first, managed });
  });

  it("fetches /info in the browser", async () => {
    injectCopilotKit({ runtimeUrl: "https://runtime.example/api" });
    await vi.waitFor(() => expect(infoCalls().length).toBeGreaterThan(0));
  });

  it("does not fetch /info on the server", async () => {
    injectCopilotKit({ runtimeUrl: "https://runtime.example/api" }, "server");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(infoCalls()).toHaveLength(0);
  });
});
