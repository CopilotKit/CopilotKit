import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopilotKit } from "./copilotkit";
import { provideCopilotKit } from "./config";
import {
  COPILOT_KIT_INSPECTOR_LOADER,
  shouldMountInspector,
  type InspectorLoader,
} from "./web-inspector";

vi.mock("@copilotkit/core", () => {
  const CopilotKitCoreRuntimeConnectionStatus = {
    Disconnected: "disconnected",
    Connected: "connected",
    Connecting: "connecting",
    Error: "error",
  } as const;

  class MockCopilotKitCore {
    readonly subscribe = vi.fn(() => ({ unsubscribe: vi.fn() }));
    readonly addTool = vi.fn();
    readonly removeTool = vi.fn();
    readonly setRuntimeUrl = vi.fn();
    readonly setRuntimeTransport = vi.fn();
    readonly setHeaders = vi.fn();
    readonly setProperties = vi.fn();
    readonly setAgents__unsafe_dev_only = vi.fn();
    readonly getAgent = vi.fn();
    agents: Record<string, any> = {};
    runtimeUrl = undefined;
    runtimeTransport = "auto";
    headers: Record<string, string> = {};
    runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;

    constructor(_config: any) {}
  }

  return {
    CopilotKitCore: MockCopilotKitCore,
    CopilotKitCoreRuntimeConnectionStatus,
  } as any;
});

const FAKE_TAG = "cpk-fake-inspector";
const licenseKey = "ck_pub_" + "a".repeat(32);

let defineSpy: ReturnType<typeof vi.fn>;
let loaderSpy: ReturnType<typeof vi.fn>;

function createLoader(): InspectorLoader {
  defineSpy = vi.fn(() => {
    if (!customElements.get(FAKE_TAG)) {
      customElements.define(
        FAKE_TAG,
        class extends HTMLElement {
          core: unknown = null;
        },
      );
    }
  });
  loaderSpy = vi.fn(async () => ({
    WEB_INSPECTOR_TAG: FAKE_TAG,
    defineWebInspector: defineSpy,
  }));
  return loaderSpy as unknown as InspectorLoader;
}

function inspectorElements(): Element[] {
  return Array.from(document.querySelectorAll(FAKE_TAG));
}

describe("shouldMountInspector", () => {
  it("returns true when explicitly true", () => {
    expect(shouldMountInspector(true)).toBe(true);
  });

  it("returns false when undefined/false", () => {
    expect(shouldMountInspector(false)).toBe(false);
  });

  it("returns true on localhost when 'auto'", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: "localhost" } as Location,
    });
    expect(shouldMountInspector("auto")).toBe(true);
  });

  it("returns false on non-localhost when 'auto'", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: "production.example.com" } as Location,
    });
    expect(shouldMountInspector("auto")).toBe(false);
  });
});

describe("CopilotKit web-inspector wiring", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll(FAKE_TAG).forEach((el) => el.remove());
  });

  afterEach(() => {
    document.querySelectorAll(FAKE_TAG).forEach((el) => el.remove());
  });

  it("does not mount the inspector when showDevConsole is unset", async () => {
    const loader = createLoader();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey }),
        { provide: COPILOT_KIT_INSPECTOR_LOADER, useValue: loader },
      ],
    });

    TestBed.inject(CopilotKit);
    await Promise.resolve();
    await Promise.resolve();

    expect(loaderSpy).not.toHaveBeenCalled();
    expect(inspectorElements()).toHaveLength(0);
  });

  it("does not mount the inspector when showDevConsole is false", async () => {
    const loader = createLoader();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, showDevConsole: false }),
        { provide: COPILOT_KIT_INSPECTOR_LOADER, useValue: loader },
      ],
    });

    TestBed.inject(CopilotKit);
    await Promise.resolve();
    await Promise.resolve();

    expect(loaderSpy).not.toHaveBeenCalled();
    expect(inspectorElements()).toHaveLength(0);
  });

  it("mounts the inspector and attaches core when showDevConsole is true", async () => {
    const loader = createLoader();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, showDevConsole: true }),
        { provide: COPILOT_KIT_INSPECTOR_LOADER, useValue: loader },
      ],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    await Promise.resolve();
    await Promise.resolve();

    expect(loaderSpy).toHaveBeenCalledTimes(1);
    expect(defineSpy).toHaveBeenCalledTimes(1);

    const elements = inspectorElements();
    expect(elements).toHaveLength(1);
    expect((elements[0] as any).core).toBe(copilotKit.core);
  });

  it("mounts the inspector when showDevConsole is 'auto' on localhost", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: "localhost" } as Location,
    });
    const loader = createLoader();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, showDevConsole: "auto" }),
        { provide: COPILOT_KIT_INSPECTOR_LOADER, useValue: loader },
      ],
    });

    TestBed.inject(CopilotKit);
    await Promise.resolve();
    await Promise.resolve();

    expect(loaderSpy).toHaveBeenCalledTimes(1);
    expect(inspectorElements()).toHaveLength(1);
  });

  it("does not mount when showDevConsole is 'auto' off localhost", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: "production.example.com" } as Location,
    });
    const loader = createLoader();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, showDevConsole: "auto" }),
        { provide: COPILOT_KIT_INSPECTOR_LOADER, useValue: loader },
      ],
    });

    TestBed.inject(CopilotKit);
    await Promise.resolve();
    await Promise.resolve();

    expect(loaderSpy).not.toHaveBeenCalled();
    expect(inspectorElements()).toHaveLength(0);
  });

  it("removes the inspector element on service destroy", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: "localhost" } as Location,
    });
    const loader = createLoader();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, showDevConsole: true }),
        { provide: COPILOT_KIT_INSPECTOR_LOADER, useValue: loader },
      ],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    await Promise.resolve();
    await Promise.resolve();
    expect(inspectorElements()).toHaveLength(1);

    copilotKit.ngOnDestroy();
    expect(inspectorElements()).toHaveLength(0);
  });

  it("never appends if destroyed before async mount resolves", async () => {
    const loader = createLoader();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, showDevConsole: true }),
        { provide: COPILOT_KIT_INSPECTOR_LOADER, useValue: loader },
      ],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    copilotKit.ngOnDestroy();
    await Promise.resolve();
    await Promise.resolve();

    expect(inspectorElements()).toHaveLength(0);
  });
});
