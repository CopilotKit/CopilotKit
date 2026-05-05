import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CopilotKit } from "./copilotkit";
import { provideCopilotKit } from "./config";
import {
  injectSandboxFunctions,
  type SandboxFunction,
} from "./sandbox-functions";

const licenseKey = "ck_pub_" + "a".repeat(32);

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
    readonly addContext = vi.fn(
      () => `ctx-${++MockCopilotKitCore.nextContextId}`,
    );
    readonly removeContext = vi.fn();
    static nextContextId = 0;
    agents: Record<string, unknown> = {};
    runtimeUrl: string | undefined = undefined;
    runtimeTransport = "auto";
    headers: Record<string, string> = {};
    runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;
  }

  return {
    CopilotKitCore: MockCopilotKitCore,
    CopilotKitCoreRuntimeConnectionStatus,
  } as unknown as Record<string, unknown>;
});

const makeSandboxFunction = (
  name: string,
  overrides?: Partial<SandboxFunction>,
): SandboxFunction => ({
  name,
  description: `${name} description`,
  parameters: z.object({ value: z.string() }),
  handler: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

function findSandboxContextCall(
  copilotKit: CopilotKit,
): { description: string; value: string } | undefined {
  const addContext = copilotKit.core.addContext as unknown as {
    mock: { calls: [{ description: string; value: string }][] };
  };
  const call = addContext.mock.calls.find(([ctx]) =>
    ctx?.description?.includes("Sandbox functions"),
  );
  return call?.[0];
}

describe("CopilotKit — openGenerativeUI.sandboxFunctions", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.getElementById("copilotkit-license-watermark")?.remove();
    (
      globalThis as { __copilotkitAngularLicenseWatermarkLogged?: boolean }
    ).__copilotkitAngularLicenseWatermarkLogged = undefined;
  });

  describe("injectSandboxFunctions", () => {
    it("exposes sandbox functions configured via provideCopilotKit", () => {
      const fns = [makeSandboxFunction("myFn")];

      TestBed.configureTestingModule({
        providers: [
          provideCopilotKit({
            licenseKey,
            openGenerativeUI: { sandboxFunctions: fns },
          }),
        ],
      });

      const result = TestBed.runInInjectionContext(() =>
        injectSandboxFunctions(),
      );

      expect(result()).toHaveLength(1);
      expect(result()[0].name).toBe("myFn");
    });

    it("returns empty array when openGenerativeUI is not set", () => {
      TestBed.configureTestingModule({
        providers: [provideCopilotKit({ licenseKey })],
      });

      const result = TestBed.runInInjectionContext(() =>
        injectSandboxFunctions(),
      );

      expect(result()).toHaveLength(0);
    });

    it("returns empty array when sandboxFunctions is not set", () => {
      TestBed.configureTestingModule({
        providers: [provideCopilotKit({ licenseKey, openGenerativeUI: {} })],
      });

      const result = TestBed.runInInjectionContext(() =>
        injectSandboxFunctions(),
      );

      expect(result()).toHaveLength(0);
    });

    it("matches the React sandbox function type contract", () => {
      const handler = vi.fn().mockResolvedValue("ok");
      const fns: SandboxFunction[] = [
        {
          name: "addToCart",
          description: "Add an item to the cart",
          parameters: z.object({ itemId: z.string(), quantity: z.number() }),
          handler,
        },
      ];

      TestBed.configureTestingModule({
        providers: [
          provideCopilotKit({
            licenseKey,
            openGenerativeUI: { sandboxFunctions: fns },
          }),
        ],
      });

      const result = TestBed.runInInjectionContext(() =>
        injectSandboxFunctions(),
      );

      const fn = result()[0];
      expect(fn.name).toBe("addToCart");
      expect(fn.description).toBe("Add an item to the cart");
      expect(fn.parameters).toBeDefined();
      expect(typeof fn.handler).toBe("function");
    });
  });

  describe("CopilotKit.sandboxFunctions signal", () => {
    it("exposes the same signal via the CopilotKit service", () => {
      const fns = [makeSandboxFunction("fnA"), makeSandboxFunction("fnB")];

      TestBed.configureTestingModule({
        providers: [
          provideCopilotKit({
            licenseKey,
            openGenerativeUI: { sandboxFunctions: fns },
          }),
        ],
      });

      const copilotKit = TestBed.inject(CopilotKit);
      const list = copilotKit.sandboxFunctions();

      expect(list).toHaveLength(2);
      expect(list.map((fn) => fn.name)).toEqual(["fnA", "fnB"]);
    });

    it("returns empty array on the service when not configured", () => {
      TestBed.configureTestingModule({
        providers: [provideCopilotKit({ licenseKey })],
      });

      const copilotKit = TestBed.inject(CopilotKit);
      expect(copilotKit.sandboxFunctions()).toHaveLength(0);
    });
  });

  describe("agent context registration", () => {
    it("registers agent context when sandbox functions are provided", () => {
      const fns = [makeSandboxFunction("addToCart")];

      TestBed.configureTestingModule({
        providers: [
          provideCopilotKit({
            licenseKey,
            openGenerativeUI: { sandboxFunctions: fns },
          }),
        ],
      });

      const copilotKit = TestBed.inject(CopilotKit);

      const sandboxCtx = findSandboxContextCall(copilotKit);
      expect(sandboxCtx).toBeDefined();
      const parsed = JSON.parse(sandboxCtx!.value);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("addToCart");
      expect(parsed[0].description).toBe("addToCart description");
      expect(parsed[0].parameters).toBeDefined();
      expect(parsed[0].parameters.type).toBe("object");
    });

    it("does not register agent context when sandbox functions are empty", () => {
      TestBed.configureTestingModule({
        providers: [
          provideCopilotKit({
            licenseKey,
            openGenerativeUI: { sandboxFunctions: [] },
          }),
        ],
      });

      const copilotKit = TestBed.inject(CopilotKit);

      expect(findSandboxContextCall(copilotKit)).toBeUndefined();
    });

    it("does not register agent context when openGenerativeUI is omitted", () => {
      TestBed.configureTestingModule({
        providers: [provideCopilotKit({ licenseKey })],
      });

      const copilotKit = TestBed.inject(CopilotKit);

      expect(findSandboxContextCall(copilotKit)).toBeUndefined();
    });

    it("includes multiple functions in agent context", () => {
      const fns = [makeSandboxFunction("fnA"), makeSandboxFunction("fnB")];

      TestBed.configureTestingModule({
        providers: [
          provideCopilotKit({
            licenseKey,
            openGenerativeUI: { sandboxFunctions: fns },
          }),
        ],
      });

      const copilotKit = TestBed.inject(CopilotKit);

      const sandboxCtx = findSandboxContextCall(copilotKit);
      const parsed = JSON.parse(sandboxCtx!.value);
      expect(parsed).toHaveLength(2);
      expect(parsed.map((f: { name: string }) => f.name)).toEqual([
        "fnA",
        "fnB",
      ]);
    });

    it("converts parameters to JSON Schema in agent context", () => {
      const fns = [
        makeSandboxFunction("myFn", {
          parameters: z.object({
            itemId: z.string(),
            quantity: z.number(),
          }),
        }),
      ];

      TestBed.configureTestingModule({
        providers: [
          provideCopilotKit({
            licenseKey,
            openGenerativeUI: { sandboxFunctions: fns },
          }),
        ],
      });

      const copilotKit = TestBed.inject(CopilotKit);

      const sandboxCtx = findSandboxContextCall(copilotKit);
      const parsed = JSON.parse(sandboxCtx!.value);
      const params = parsed[0].parameters;

      expect(params.type).toBe("object");
      expect(params.properties.itemId).toEqual({ type: "string" });
      expect(params.properties.quantity).toEqual({ type: "number" });
    });
  });
});
