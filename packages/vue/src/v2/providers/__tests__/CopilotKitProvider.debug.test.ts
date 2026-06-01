import { cleanup, render } from "@testing-library/vue";
import { defineComponent, nextTick } from "vue";
import type { Component, PropType } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugConfig } from "@copilotkit/shared";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useCopilotKit } from "../useCopilotKit";
import type { CopilotKitCoreVue } from "../../lib/vue-core";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function renderProvider(args: {
  child: Component;
  debug?: DebugConfig;
  runtimeUrl?: string;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  properties?: Record<string, unknown>;
  agents__unsafe_dev_only?: Record<string, unknown>;
  defaultThrottleMs?: number;
}) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      ChildComponent: args.child,
    },
    props: {
      runtimeUrl: { type: String, required: false },
      debug: {
        type: [Boolean, Object] as PropType<DebugConfig | undefined>,
        required: false,
        default: undefined,
      },
      credentials: {
        type: String as PropType<RequestCredentials | undefined>,
        required: false,
        default: undefined,
      },
      headers: {
        type: Object as PropType<Record<string, string> | undefined>,
        required: false,
        default: undefined,
      },
      properties: {
        type: Object as PropType<Record<string, unknown> | undefined>,
        required: false,
        default: undefined,
      },
      agents__unsafe_dev_only: {
        type: Object as PropType<Record<string, unknown> | undefined>,
        required: false,
        default: undefined,
      },
      defaultThrottleMs: {
        type: Number,
        required: false,
        default: undefined,
      },
    },
    template: `
      <CopilotKitProvider
        :runtime-url="runtimeUrl"
        :debug="debug"
        :credentials="credentials"
        :headers="headers"
        :properties="properties"
        :agents__unsafe_dev_only="agents__unsafe_dev_only"
        :default-throttle-ms="defaultThrottleMs"
      >
        <ChildComponent />
      </CopilotKitProvider>
    `,
  });

  return render(Host, {
    props: {
      runtimeUrl: args.runtimeUrl ?? "/api/copilotkit",
      debug: args.debug,
      credentials: args.credentials,
      headers: args.headers,
      properties: args.properties,
      agents__unsafe_dev_only: args.agents__unsafe_dev_only,
      defaultThrottleMs: args.defaultThrottleMs,
    },
  });
}

function createCoreCollector(): {
  child: Component;
  getCore: () => CopilotKitCoreVue;
  getInstances: () => CopilotKitCoreVue[];
} {
  const instances: CopilotKitCoreVue[] = [];
  const Collector = defineComponent({
    setup() {
      const { copilotkit } = useCopilotKit();
      instances.push(copilotkit.value);
      return () => null;
    },
  });
  return {
    child: Collector,
    getCore: () => {
      if (instances.length === 0) {
        throw new Error("CopilotKit core not captured yet");
      }
      return instances[instances.length - 1]!;
    },
    getInstances: () => instances,
  };
}

describe("CopilotKitProvider debug", () => {
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe("initial threading", () => {
    it("threads debug=true through to copilotkit.debug on mount", async () => {
      const { child, getCore } = createCoreCollector();

      renderProvider({ child, debug: true });
      await nextTick();

      expect(getCore().debug).toBe(true);
    });

    it("preserves the exact object config shape on the core instance", async () => {
      const { child, getCore } = createCoreCollector();
      const debugConfig: DebugConfig = {
        events: true,
        lifecycle: false,
        verbose: true,
      };

      renderProvider({ child, debug: debugConfig });
      await nextTick();

      expect(getCore().debug).toEqual({
        events: true,
        lifecycle: false,
        verbose: true,
      });
    });

    it("leaves copilotkit.debug undefined when debug prop is omitted", async () => {
      const { child, getCore } = createCoreCollector();

      renderProvider({ child });
      await nextTick();

      expect(getCore().debug).toBeUndefined();
    });
  });

  describe("runtime sync", () => {
    it("updates copilotkit.debug when the prop changes after mount", async () => {
      const { child, getCore } = createCoreCollector();

      const view = renderProvider({ child, debug: false });
      await nextTick();
      expect(getCore().debug).toBe(false);

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        debug: { events: true, lifecycle: true, verbose: true },
      });
      await nextTick();

      expect(getCore().debug).toEqual({
        events: true,
        lifecycle: true,
        verbose: true,
      });
    });

    it("does not recreate the CopilotKitCoreVue instance when debug changes", async () => {
      const { child, getInstances } = createCoreCollector();

      const view = renderProvider({ child, debug: false });
      await nextTick();
      const initialInstance = getInstances()[0];
      expect(initialInstance).toBeDefined();

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        debug: true,
      });
      await nextTick();

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        debug: { events: false, lifecycle: true },
      });
      await nextTick();

      for (const instance of getInstances()) {
        expect(instance).toBe(initialInstance);
      }
    });

    it("calls setDebug on the stable core instance for each prop change", async () => {
      const { child, getCore } = createCoreCollector();

      const view = renderProvider({ child, debug: false });
      await nextTick();

      const core = getCore();
      const setDebugSpy = vi.spyOn(core, "setDebug");

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        debug: true,
      });
      await nextTick();

      expect(setDebugSpy).toHaveBeenCalledWith(true);
    });
  });

  describe("clearing behavior", () => {
    it("clears the core debug config when debug changes from truthy to undefined", async () => {
      const { child, getCore } = createCoreCollector();

      const view = renderProvider({
        child,
        debug: { events: true, lifecycle: true },
      });
      await nextTick();
      expect(getCore().debug).toEqual({ events: true, lifecycle: true });

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        debug: undefined,
      });
      await nextTick();

      expect(getCore().debug).toBeUndefined();
    });
  });

  describe("regression safety", () => {
    it("does not affect neighboring runtime config prop-sync behavior", async () => {
      const { child, getCore } = createCoreCollector();

      const view = renderProvider({
        child,
        runtimeUrl: "/api/copilotkit",
        credentials: "include",
        headers: { "X-Init": "1" },
        properties: { initial: true },
        agents__unsafe_dev_only: {},
        defaultThrottleMs: 100,
        debug: false,
      });
      await nextTick();

      const core = getCore();
      const setRuntimeUrlSpy = vi.spyOn(core, "setRuntimeUrl");
      const setHeadersSpy = vi.spyOn(core, "setHeaders");
      const setCredentialsSpy = vi.spyOn(core, "setCredentials");
      const setPropertiesSpy = vi.spyOn(core, "setProperties");
      const setAgentsSpy = vi.spyOn(core, "setAgents__unsafe_dev_only");
      const setDefaultThrottleSpy = vi.spyOn(core, "setDefaultThrottleMs");
      const setDebugSpy = vi.spyOn(core, "setDebug");

      await view.rerender({
        runtimeUrl: "/api/copilotkit/v2",
        credentials: "same-origin",
        headers: { "X-Updated": "1" },
        properties: { initial: true, added: 42 },
        agents__unsafe_dev_only: {},
        defaultThrottleMs: 200,
        debug: true,
      });
      await nextTick();

      expect(setRuntimeUrlSpy).toHaveBeenCalledWith("/api/copilotkit/v2");
      expect(setHeadersSpy).toHaveBeenCalled();
      expect(setCredentialsSpy).toHaveBeenCalledWith("same-origin");
      expect(setPropertiesSpy).toHaveBeenCalled();
      expect(setAgentsSpy).toHaveBeenCalled();
      expect(setDefaultThrottleSpy).toHaveBeenCalledWith(200);
      expect(setDebugSpy).toHaveBeenCalledWith(true);
    });
  });
});
