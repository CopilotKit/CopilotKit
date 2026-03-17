import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, watchEffect } from "vue";
import type {
  CopilotKitCoreSubscriber,
  FrontendToolHandlerContext,
} from "@copilotkitnext/core";
import {
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkitnext/core";
import { defineWebInspector } from "@copilotkitnext/web-inspector";
import { z } from "zod";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useCopilotKit } from "../useCopilotKit";
import type { VueFrontendTool } from "../../types";
import type { VueHumanInTheLoop } from "../../types";
import { mountWithProvider } from "../../__tests__/utils/mount";
import { StateCapturingAgent } from "../../__tests__/utils/agents";

type CopilotKitCoreContextValue = ReturnType<
  typeof useCopilotKit
>["copilotkit"]["value"];

interface CopilotKitCoreTestAccess {
  notifySubscribers: (
    handler: (subscriber: CopilotKitCoreSubscriber) => void | Promise<void>,
    errorMessage: string,
  ) => Promise<void>;
}

describe("CopilotKitProvider", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(defineWebInspector).mockClear();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    global.fetch = originalFetch;
  });

  describe("Basic functionality", () => {
    it("provides context to children", () => {
      const Child = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          return () =>
            h(
              "span",
              { "data-testid": "has-copilotkit" },
              copilotkit.value ? "yes" : "no",
            );
        },
      });

      const wrapper = mount(CopilotKitProvider, {
        props: { runtimeUrl: "/api/copilotkit" },
        slots: { default: () => h(Child) },
      });

      expect(wrapper.find("[data-testid=has-copilotkit]").text()).toBe("yes");
    });

    it("throws when useCopilotKit used outside provider", () => {
      const OutOfContext = defineComponent({
        setup() {
          useCopilotKit();
          return () => h("div");
        },
      });
      expect(() => mount(OutOfContext)).toThrow(
        "useCopilotKit must be used within CopilotKitProvider",
      );
    });

    it("warns when runtime props transition from valid to invalid", async () => {
      const wrapper = mount(CopilotKitProvider, {
        props: { runtimeUrl: "/api/copilotkit" },
        slots: { default: () => h("div", "test") },
      });

      await wrapper.setProps({ runtimeUrl: undefined });
      await nextTick();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'",
        ),
      );
    });

    it("does not multiply runtime invalidations across multiple useCopilotKit consumers", async () => {
      const mockAgent = new StateCapturingAgent([], "default");
      let coreRef: CopilotKitCoreContextValue | null = null;

      const Probe = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          coreRef = copilotkit.value;
          return () => null;
        },
      });

      const Consumer = defineComponent({
        props: {
          testId: {
            type: String,
            required: true,
          },
        },
        setup(props) {
          const { copilotkit } = useCopilotKit();
          const count = ref(0);
          watchEffect(() => {
            void copilotkit.value.runtimeConnectionStatus;
            count.value += 1;
          });
          return () =>
            h("span", { "data-testid": props.testId }, String(count.value));
        },
      });

      const wrapper = mount(CopilotKitProvider, {
        props: {
          agents__unsafe_dev_only: { default: mockAgent },
        },
        slots: {
          default: () =>
            h("div", [
              h(Consumer, { testId: "consumer-a" }),
              h(Consumer, { testId: "consumer-b" }),
              h(Probe),
            ]),
        },
      });

      await nextTick();
      expect(wrapper.find("[data-testid=consumer-a]").text()).toBe("1");
      expect(wrapper.find("[data-testid=consumer-b]").text()).toBe("1");
      expect(coreRef).toBeTruthy();
      if (!coreRef) {
        throw new Error("CopilotKit core reference is missing");
      }

      await (coreRef as unknown as CopilotKitCoreTestAccess).notifySubscribers(
        (subscriber) =>
          subscriber.onRuntimeConnectionStatusChanged?.({
            copilotkit: coreRef,
            status: CopilotKitCoreRuntimeConnectionStatus.Connected,
          }),
        "test runtime event",
      );
      await nextTick();

      expect(wrapper.find("[data-testid=consumer-a]").text()).toBe("2");
      expect(wrapper.find("[data-testid=consumer-b]").text()).toBe("2");
    });

    it("treats selfManagedAgents as local agents for runtime validation", () => {
      const selfManagedAgent = new StateCapturingAgent([], "default");

      mount(CopilotKitProvider, {
        props: {
          runtimeUrl: undefined,
          selfManagedAgents: { default: selfManagedAgent },
        },
        slots: { default: () => h("div", "test") },
      });

      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining(
          "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'",
        ),
      );
    });

    it("registers selfManagedAgents with CopilotKitCore", () => {
      const selfManagedAgent = new StateCapturingAgent([], "default");
      selfManagedAgent.state = { source: "self-managed" };

      const { getCore } = mountWithProvider(() => h("div"), {
        runtimeUrl: undefined,
        selfManagedAgents: { default: selfManagedAgent },
      });

      expect(getCore().getAgent("default")?.state).toEqual({
        source: "self-managed",
      });
    });

    it("prefers selfManagedAgents over agents__unsafe_dev_only for the same id", () => {
      const unsafeAgent = new StateCapturingAgent([], "shared");
      const selfManagedAgent = new StateCapturingAgent([], "shared");
      unsafeAgent.state = { source: "unsafe" };
      selfManagedAgent.state = { source: "self-managed" };

      const { getCore } = mountWithProvider(() => h("div"), {
        agents__unsafe_dev_only: { shared: unsafeAgent },
        selfManagedAgents: { shared: selfManagedAgent },
      });

      expect(getCore().getAgent("shared")?.state).toEqual({
        source: "self-managed",
      });
    });

    it("forwards core errors to onError", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
      const onError = vi.fn();

      mount(CopilotKitProvider, {
        props: {
          runtimeUrl: "http://localhost:59999/nonexistent",
          onError,
        },
        slots: { default: () => h("div", "test") },
      });

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });

      const event = onError.mock.calls[0][0] as {
        error: Error;
        code: CopilotKitCoreErrorCode;
        context: Record<string, any>;
      };
      expect(event.code).toBe(CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED);
      expect(event.error).toBeInstanceOf(Error);
      expect(event.error.message).toContain("network failure");
      expect(event.context).toEqual(expect.any(Object));
    });

    it("fires onError without publicApiKey", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
      const onError = vi.fn();

      mount(CopilotKitProvider, {
        props: {
          runtimeUrl: "http://localhost:59999/nonexistent",
          onError,
        },
        slots: { default: () => h("div", "test") },
      });

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });
    });
  });

  describe("frontendTools prop", () => {
    it("registers frontend tools with CopilotKitCore", () => {
      const mockHandler = vi.fn();
      const frontendTools: VueFrontendTool[] = [
        {
          name: "testTool",
          description: "A test tool",
          parameters: z.object({ input: z.string() }),
          handler: mockHandler,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { frontendTools });
      const tool = getCore().getTool({ toolName: "testTool" });
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("testTool");
      expect(tool?.handler).toBe(mockHandler);
    });

    it("includes render components from frontend tools", () => {
      const TestComponent = defineComponent({
        setup() {
          return () => h("div", "Test");
        },
      });
      const frontendTools: VueFrontendTool[] = [
        {
          name: "renderTool",
          description: "A tool with render",
          parameters: z.object({ input: z.string() }),
          render: TestComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { frontendTools });
      const renderTool = getCore().renderToolCalls.find(
        (rc) => rc.name === "renderTool",
      );
      expect(renderTool).toBeDefined();
      expect(renderTool?.render).toStrictEqual(TestComponent);
    });

    it("does not scope frontendTools-derived render entries by agentId", () => {
      const TestComponent = defineComponent({
        setup() {
          return () => h("div", "Test");
        },
      });
      const frontendTools: VueFrontendTool[] = [
        {
          name: "agentRenderTool",
          description: "A tool with render and agentId",
          parameters: z.object({ input: z.string() }),
          render: TestComponent,
          agentId: "specific-agent",
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { frontendTools });
      const renderTool = getCore().renderToolCalls.find(
        (rc) => rc.name === "agentRenderTool",
      );

      expect(renderTool).toBeDefined();
      expect(renderTool?.agentId).toBeUndefined();
    });

    it("warns when frontendTools prop changes", async () => {
      const initialTools: VueFrontendTool[] = [
        { name: "tool1", description: "Tool 1" },
      ];
      const newTools: VueFrontendTool[] = [
        { name: "tool2", description: "Tool 2" },
      ];

      const wrapper = mount(CopilotKitProvider, {
        props: { runtimeUrl: "/api/copilotkit", frontendTools: initialTools },
        slots: { default: () => h("div", "Test") },
      });

      await wrapper.setProps({ frontendTools: newTools });
      await nextTick();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("frontendTools must be a stable array"),
      );
    });
  });

  describe("Prop updates after mount", () => {
    it("applies frontendTools updates even when stable-array warning is emitted", async () => {
      const initialTools: VueFrontendTool[] = [
        { name: "tool1", description: "Tool 1", handler: vi.fn() },
      ];
      const nextTools: VueFrontendTool[] = [
        { name: "tool2", description: "Tool 2", handler: vi.fn() },
      ];
      let coreRef: CopilotKitCoreContextValue | null = null;

      const Probe = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          watchEffect(() => {
            coreRef = copilotkit.value;
          });
          return () => null;
        },
      });

      const wrapper = mount(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          frontendTools: initialTools,
        },
        slots: {
          default: () => h(Probe),
        },
      });

      await nextTick();
      const initialCore = coreRef;
      expect(coreRef?.getTool({ toolName: "tool1" })).toBeDefined();

      await wrapper.setProps({ frontendTools: nextTools });
      await nextTick();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("frontendTools must be a stable array"),
      );
      expect(coreRef).toBeTruthy();
      expect(coreRef).not.toBe(initialCore);
      expect(coreRef?.getTool({ toolName: "tool2" })).toBeDefined();
      expect(coreRef?.getTool({ toolName: "tool1" })).toBeUndefined();
    });
  });

  describe("humanInTheLoop prop", () => {
    it("processes humanInTheLoop tools and creates handlers", () => {
      const TestComponent = defineComponent({
        setup() {
          return () => h("div", "Test");
        },
      });
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "approvalTool",
          description: "Requires human approval",
          parameters: z.object({ question: z.string() }),
          render: TestComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });
      const tool = getCore().getTool({ toolName: "approvalTool" });
      expect(tool).toBeDefined();
      expect(tool?.handler).toBeDefined();

      const renderTool = getCore().renderToolCalls.find(
        (rc) => rc.name === "approvalTool",
      );
      expect(renderTool).toBeDefined();
      expect(renderTool?.render).toStrictEqual(TestComponent);
    });

    it("creates placeholder handlers for humanInTheLoop tools", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () => h("div", "Test");
        },
      });
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "interactiveTool",
          description: "Interactive tool",
          parameters: z.object({ data: z.string() }),
          render: TestComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });
      const handler = getCore().getTool({
        toolName: "interactiveTool",
      })?.handler;
      expect(handler).toBeDefined();

      const result = await handler!(
        { data: "test" },
        {} as unknown as FrontendToolHandlerContext,
      );
      expect(result).toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Human-in-the-loop tool 'interactiveTool' called",
        ),
      );
    });

    it("warns when humanInTheLoop prop changes", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () => h("div", "Test");
        },
      });
      const initialTools: VueHumanInTheLoop[] = [
        { name: "tool1", description: "Tool 1", render: TestComponent },
      ];
      const newTools: VueHumanInTheLoop[] = [
        { name: "tool2", description: "Tool 2", render: TestComponent },
      ];

      const wrapper = mount(CopilotKitProvider, {
        props: { runtimeUrl: "/api/copilotkit", humanInTheLoop: initialTools },
        slots: { default: () => h("div", "Test") },
      });

      await wrapper.setProps({ humanInTheLoop: newTools });
      await nextTick();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("humanInTheLoop must be a stable array"),
      );
    });
  });

  describe("Combined tools functionality", () => {
    it("registers both frontendTools and humanInTheLoop tools", () => {
      const TestComponent = defineComponent({
        setup() {
          return () => h("div", "Test");
        },
      });
      const frontendTools: VueFrontendTool[] = [
        {
          name: "frontendTool",
          description: "Frontend tool",
          handler: vi.fn(),
        },
      ];
      const humanInTheLoop: VueHumanInTheLoop[] = [
        { name: "humanTool", description: "Human tool", render: TestComponent },
      ];

      const { getCore } = mountWithProvider(() => h("div"), {
        frontendTools,
        humanInTheLoop,
      });
      expect(getCore().getTool({ toolName: "frontendTool" })).toBeDefined();
      expect(getCore().getTool({ toolName: "humanTool" })).toBeDefined();
    });

    it("handles agentId in frontend tools", () => {
      const frontendTools: VueFrontendTool[] = [
        {
          name: "globalTool",
          description: "Global tool",
          handler: vi.fn(),
        },
        {
          name: "agentSpecificTool",
          description: "Agent specific tool",
          handler: vi.fn(),
          agentId: "specificAgent",
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { frontendTools });
      const globalTool = getCore().getTool({ toolName: "globalTool" });
      const agentTool = getCore().getTool({
        toolName: "agentSpecificTool",
        agentId: "specificAgent",
      });

      expect(globalTool).toBeDefined();
      expect(globalTool?.agentId).toBeUndefined();
      expect(agentTool).toBeDefined();
      expect(agentTool?.agentId).toBe("specificAgent");
    });

    it("combines render components from all sources", () => {
      const TestComponent1 = defineComponent({
        setup() {
          return () => h("div", "Test1");
        },
      });
      const TestComponent2 = defineComponent({
        setup() {
          return () => h("div", "Test2");
        },
      });

      const frontendTools: VueFrontendTool[] = [
        {
          name: "frontendRenderTool",
          description: "Frontend render tool",
          parameters: z.object({ a: z.string() }),
          render: TestComponent1,
        },
      ];
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "humanRenderTool",
          description: "Human render tool",
          parameters: z.object({ b: z.string() }),
          render: TestComponent2,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), {
        frontendTools,
        humanInTheLoop,
      });

      const frontendRenderTool = getCore().renderToolCalls.find(
        (rc) => rc.name === "frontendRenderTool",
      );
      const humanRenderTool = getCore().renderToolCalls.find(
        (rc) => rc.name === "humanRenderTool",
      );

      expect(frontendRenderTool).toBeDefined();
      expect(humanRenderTool).toBeDefined();
      expect(frontendRenderTool?.render).toStrictEqual(TestComponent1);
      expect(humanRenderTool?.render).toStrictEqual(TestComponent2);
    });
  });

  describe("Edge cases", () => {
    it("handles empty arrays for tools", () => {
      const { getCore } = mountWithProvider(() => h("div"), {
        frontendTools: [],
        humanInTheLoop: [],
      });

      expect(getCore().tools).toHaveLength(0);
      expect(getCore().renderToolCalls).toHaveLength(0);
    });

    it("handles tools without render components", () => {
      const frontendTools: VueFrontendTool[] = [
        {
          name: "noRenderTool",
          description: "Tool without render",
          handler: vi.fn(),
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { frontendTools });
      expect(getCore().getTool({ toolName: "noRenderTool" })).toBeDefined();
      const noRenderTool = getCore().renderToolCalls.find(
        (rc) => rc.name === "noRenderTool",
      );
      expect(noRenderTool).toBeUndefined();
    });

    it("handles humanInTheLoop tools with followUp flag", () => {
      const TestComponent = defineComponent({
        setup() {
          return () => h("div", "Test");
        },
      });
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "followUpTool",
          description: "Tool with followUp",
          parameters: z.object({ a: z.string() }),
          followUp: false,
          render: TestComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });
      const tool = getCore().getTool({ toolName: "followUpTool" });
      expect(tool?.followUp).toBe(false);
    });

    it("renders inspector when showDevConsole is true", async () => {
      const wrapper = mount(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          showDevConsole: true,
        },
        slots: {
          default: () => h("div", "test"),
        },
      });

      await nextTick();
      await vi.dynamicImportSettled();
      await nextTick();

      expect(wrapper.find("cpk-web-inspector").exists()).toBe(true);
      expect(defineWebInspector).toHaveBeenCalledTimes(1);
    });

    it("renders inspector on localhost when showDevConsole is auto", async () => {
      const wrapper = mount(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          showDevConsole: "auto",
        },
        slots: {
          default: () => h("div", "test"),
        },
      });

      await nextTick();
      await vi.dynamicImportSettled();
      await nextTick();

      const shouldRenderOnThisHost = new Set(["localhost", "127.0.0.1"]).has(
        window.location.hostname,
      );

      expect(wrapper.find("cpk-web-inspector").exists()).toBe(
        shouldRenderOnThisHost,
      );
    });

    it("does not render inspector when showDevConsole is false", async () => {
      const wrapper = mount(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          showDevConsole: false,
        },
        slots: {
          default: () => h("div", "test"),
        },
      });

      await nextTick();
      await vi.dynamicImportSettled();
      await nextTick();

      expect(wrapper.find("cpk-web-inspector").exists()).toBe(false);
    });
  });
});
