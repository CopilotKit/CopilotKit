import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/vue";
import { mount } from "@vue/test-utils";
import {
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  ref,
  watchEffect,
} from "vue";
import type { VNode } from "vue";
import { renderToString } from "vue/server-renderer";
import type {
  CopilotKitCoreSubscriber,
  FrontendToolHandlerContext,
} from "@copilotkit/core";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ToolCallStatus,
} from "@copilotkit/core";
import { defineWebInspector } from "@copilotkit/web-inspector";
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

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(defineWebInspector).mockClear();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

    it("supports function-valued headers and refreshes runtime headers", async () => {
      const authToken = ref("initial");
      const { getCore } = mountWithProvider(() => h("div"), {
        runtimeUrl: "/api/copilotkit",
        headers: () => ({
          Authorization: `Bearer ${authToken.value}`,
        }),
      });

      expect(getCore().headers).toMatchObject({
        Authorization: "Bearer initial",
      });

      authToken.value = "updated";
      await nextTick();
      await nextTick();

      expect(getCore().headers).toMatchObject({
        Authorization: "Bearer updated",
      });
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

    it("exposes a2ui theme through provider context", () => {
      const Child = defineComponent({
        setup() {
          const { a2uiTheme } = useCopilotKit();
          return () =>
            h(
              "span",
              { "data-testid": "a2ui-theme" },
              String(
                (a2uiTheme.value as { mode?: string } | undefined)?.mode ??
                  "missing",
              ),
            );
        },
      });

      const wrapper = mount(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          a2ui: {
            theme: { mode: "storybook" },
          },
        },
        slots: { default: () => h(Child) },
      });

      expect(wrapper.find("[data-testid=a2ui-theme]").text()).toBe("storybook");
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
  });

  describe("humanInTheLoop prop", () => {
    const HitlComponent = defineComponent({
      setup() {
        return () => h("div", "Test");
      },
    });

    /** A handler context shaped like the one core passes to frontend tools. */
    const hitlContext = (toolCallId: string, signal?: AbortSignal) =>
      ({
        toolCall: { id: toolCallId },
        signal,
      }) as unknown as FrontendToolHandlerContext;

    /**
     * Invokes the provider's registered renderer the way `useRenderToolCall`
     * does and returns the props it forwarded to the user's component. The
     * wrapper builds its VNode with `h()`, so the injected props are readable
     * without mounting.
     */
    const renderHitl = (
      getCore: () => CopilotKitCoreContextValue,
      registeredName: string,
      props: Record<string, unknown>,
    ) => {
      const render = getCore().renderToolCalls.find(
        (rc) => rc.name === registeredName,
      )?.render as (p: Record<string, unknown>) => VNode;
      return render(props).props as {
        name?: string;
        description?: string;
        agentId?: string;
        respond?: (result: unknown) => Promise<void>;
      };
    };

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("processes humanInTheLoop tools and creates handlers", () => {
      const TestComponent = HitlComponent;
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

      // The registered renderer wraps the user's component so `respond` and the
      // tool's description can be injected per status.
      const renderTool = getCore().renderToolCalls.find(
        (rc) => rc.name === "approvalTool",
      );
      expect(renderTool).toBeDefined();
      expect(typeof renderTool?.render).toBe("function");
    });

    it("keeps the tool call pending until respond is called", async () => {
      // Reproduces OSS-803: the handler used to warn and resolve undefined
      // immediately, so the HITL UI flashed and disappeared instead of waiting
      // for the user.
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "interactiveTool",
          description: "Interactive tool",
          parameters: z.object({ data: z.string() }),
          render: HitlComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });
      const handler = getCore().getTool({
        toolName: "interactiveTool",
      })?.handler;
      expect(handler).toBeDefined();

      let settled = false;
      const pending = handler!({ data: "test" }, hitlContext("tc-1")).then(
        (result) => {
          settled = true;
          return result;
        },
      );

      await flush();
      expect(settled).toBe(false);
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("no interactive handler is set up"),
      );

      const props = renderHitl(getCore, "interactiveTool", {
        name: "interactiveTool",
        toolCallId: "tc-1",
        args: { data: "test" },
        status: ToolCallStatus.Executing,
        result: undefined,
      });

      expect(props.respond).toBeDefined();
      await props.respond!("approved");

      await expect(pending).resolves.toBe("approved");
    });

    it("exposes respond only while the tool is executing", () => {
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "interactiveTool",
          description: "Interactive tool",
          parameters: z.object({ data: z.string() }),
          render: HitlComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });

      const inProgress = renderHitl(getCore, "interactiveTool", {
        name: "interactiveTool",
        toolCallId: "tc-1",
        args: { data: "test" },
        status: ToolCallStatus.InProgress,
        result: undefined,
      });
      expect(inProgress.respond).toBeUndefined();
      expect(inProgress.description).toBe("Interactive tool");

      const complete = renderHitl(getCore, "interactiveTool", {
        name: "interactiveTool",
        toolCallId: "tc-1",
        args: { data: "test" },
        status: ToolCallStatus.Complete,
        result: "approved",
      });
      expect(complete.respond).toBeUndefined();
    });

    it("rejects the pending tool call when the run is aborted", async () => {
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "interactiveTool",
          description: "Interactive tool",
          parameters: z.object({ data: z.string() }),
          render: HitlComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });
      const handler = getCore().getTool({
        toolName: "interactiveTool",
      })?.handler;

      const controller = new AbortController();
      const pending = handler!(
        { data: "test" },
        hitlContext("tc-1", controller.signal),
      );

      controller.abort();

      // An explicit rejection makes core record an error tool result rather
      // than silently resolving empty (#5554).
      await expect(pending).rejects.toThrow(
        "Human-in-the-loop interaction aborted",
      );
    });

    it("rejects immediately when the run was already aborted", async () => {
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "interactiveTool",
          description: "Interactive tool",
          parameters: z.object({ data: z.string() }),
          render: HitlComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });
      const handler = getCore().getTool({
        toolName: "interactiveTool",
      })?.handler;

      const controller = new AbortController();
      controller.abort();

      await expect(
        handler!({ data: "test" }, hitlContext("tc-1", controller.signal)),
      ).rejects.toThrow("Human-in-the-loop interaction aborted");
    });

    it("keeps parallel interrupts on the same tool independent", async () => {
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "interactiveTool",
          description: "Interactive tool",
          parameters: z.object({ data: z.string() }),
          render: HitlComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });
      const handler = getCore().getTool({
        toolName: "interactiveTool",
      })?.handler;

      const first = handler!({ data: "one" }, hitlContext("tc-1"));
      const second = handler!({ data: "two" }, hitlContext("tc-2"));

      let firstSettled = false;
      void first.then(() => {
        firstSettled = true;
      });
      let secondSettled = false;
      void second.then(() => {
        secondSettled = true;
      });

      // Respond to the second tool call only.
      const secondProps = renderHitl(getCore, "interactiveTool", {
        name: "interactiveTool",
        toolCallId: "tc-2",
        args: { data: "two" },
        status: ToolCallStatus.Executing,
        result: undefined,
      });
      await secondProps.respond!("two-approved");
      await expect(second).resolves.toBe("two-approved");

      // The first is still waiting on its own user response.
      await flush();
      expect(firstSettled).toBe(false);
      expect(secondSettled).toBe(true);

      const firstProps = renderHitl(getCore, "interactiveTool", {
        name: "interactiveTool",
        toolCallId: "tc-1",
        args: { data: "one" },
        status: ToolCallStatus.Executing,
        result: undefined,
      });
      await firstProps.respond!("one-approved");
      await expect(first).resolves.toBe("one-approved");
    });

    it("passes the actual invoked tool name to a wildcard HITL renderer", () => {
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "*",
          description: "Approve any tool",
          parameters: z.object({ data: z.string() }),
          render: HitlComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });

      const props = renderHitl(getCore, "*", {
        name: "deleteFile",
        toolCallId: "tc-1",
        args: { data: "test" },
        status: ToolCallStatus.Executing,
        result: undefined,
      });

      expect(props.name).toBe("deleteFile");
    });

    it("passes agentId through to the HITL renderer", () => {
      const humanInTheLoop: VueHumanInTheLoop[] = [
        {
          name: "scopedTool",
          description: "Scoped to one agent",
          parameters: z.object({ data: z.string() }),
          agentId: "specific-agent",
          render: HitlComponent,
        },
      ];

      const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });

      // `VueHumanInTheLoopRenderProps` declares `agentId`, and the
      // `useHumanInTheLoop` composable supplies it. The prop path must too.
      const props = renderHitl(getCore, "scopedTool", {
        name: "scopedTool",
        toolCallId: "tc-1",
        args: { data: "test" },
        status: ToolCallStatus.Executing,
        result: undefined,
      });

      expect(props.agentId).toBe("specific-agent");
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
      // A humanInTheLoop render is wrapped so `respond` can be injected, so it
      // is not the component itself — assert it delegates to it.
      const humanRender = humanRenderTool?.render as (
        p: Record<string, unknown>,
      ) => VNode;
      expect(
        humanRender({
          name: "humanRenderTool",
          toolCallId: "tc-1",
          args: { b: "value" },
          status: ToolCallStatus.Executing,
          result: undefined,
        }).type,
      ).toStrictEqual(TestComponent2);
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
  });

  describe("inspector visibility", () => {
    async function settleInspectorLoad(): Promise<void> {
      await vi.dynamicImportSettled();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await nextTick();
    }

    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "development");
    });

    it("renders by default on any development host and passes the provider core before connection", async () => {
      let providerCore: CopilotKitCoreContextValue | null = null;
      const Probe = defineComponent({
        setup() {
          providerCore = useCopilotKit().copilotkit.value;
          return () => null;
        },
      });
      const view = render(CopilotKitProvider, {
        props: { runtimeUrl: "/api/copilotkit" },
        slots: { default: Probe },
      });

      await waitFor(() => {
        expect(
          view.container.querySelector("cpk-web-inspector"),
        ).not.toBeNull();
      });
      const inspector = view.container.querySelector(
        "cpk-web-inspector",
      ) as HTMLElement & {
        autoAttachCore?: boolean;
        autoAttachCoreAtConnection?: boolean;
        core?: unknown;
        coreAtConnection?: unknown;
      };
      expect(inspector.core).toBe(providerCore);
      expect(inspector.autoAttachCore).toBe(false);
      expect(inspector.coreAtConnection).toBe(providerCore);
      expect(inspector.autoAttachCoreAtConnection).toBe(false);
      expect(defineWebInspector).toHaveBeenCalledTimes(1);
      view.unmount();
    });

    it("does not render or load when explicitly disabled in development", async () => {
      const view = render(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          enableInspector: false,
        },
        slots: { default: "child" },
      });

      await settleInspectorLoad();
      expect(view.container.querySelector("cpk-web-inspector")).toBeNull();
      expect(defineWebInspector).not.toHaveBeenCalled();
      view.unmount();
    });

    it("never renders or loads in production, even when explicitly enabled", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const view = render(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          enableInspector: true,
        },
        slots: { default: "child" },
      });

      await settleInspectorLoad();
      expect(view.container.querySelector("cpk-web-inspector")).toBeNull();
      expect(defineWebInspector).not.toHaveBeenCalled();
      view.unmount();
    });

    it("does not let legacy showDevConsole disable the development Inspector", async () => {
      const view = render(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          showDevConsole: false,
        },
        slots: { default: "child" },
      });

      await waitFor(() => {
        expect(
          view.container.querySelector("cpk-web-inspector"),
        ).not.toBeNull();
      });
      view.unmount();
    });

    it("does not let legacy showDevConsole enable the production Inspector", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const view = render(CopilotKitProvider, {
        props: {
          runtimeUrl: "/api/copilotkit",
          showDevConsole: "auto",
        },
        slots: { default: "child" },
      });

      await settleInspectorLoad();
      expect(view.container.querySelector("cpk-web-inspector")).toBeNull();
      expect(defineWebInspector).not.toHaveBeenCalled();
      view.unmount();
    });

    it("does not render or load the inspector during SSR", async () => {
      vi.stubGlobal("window", undefined);
      const html = await renderToString(
        createSSRApp(CopilotKitProvider, {
          runtimeUrl: "/api/copilotkit",
          enableInspector: true,
        }),
      );
      await settleInspectorLoad();
      expect(html).not.toContain("cpk-web-inspector");
      expect(defineWebInspector).not.toHaveBeenCalled();
    });

    it("hydrates development markup before mounting the Inspector", async () => {
      const props = {
        runtimeUrl: "/api/copilotkit",
        enableInspector: true,
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const browserWindow = window;

      vi.stubGlobal("window", undefined);
      container.innerHTML = await renderToString(
        createSSRApp(CopilotKitProvider, props),
      );
      vi.stubGlobal("window", browserWindow);

      expect(container.innerHTML).not.toContain("cpk-web-inspector");
      expect(defineWebInspector).not.toHaveBeenCalled();

      const app = createSSRApp(CopilotKitProvider, props);
      app.mount(container);

      try {
        await waitFor(() => {
          expect(container.querySelector("cpk-web-inspector")).not.toBeNull();
        });
        const hydrationOutput = [
          ...consoleWarnSpy.mock.calls,
          ...consoleErrorSpy.mock.calls,
        ]
          .flat()
          .join(" ");
        expect(hydrationOutput).not.toContain("Hydration");
      } finally {
        app.unmount();
        container.remove();
      }
    });
  });
});
