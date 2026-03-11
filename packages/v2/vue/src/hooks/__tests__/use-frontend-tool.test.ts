import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import type { AbstractAgent, Message } from "@ag-ui/client";
import { useFrontendTool } from "../use-frontend-tool";
import type { VueFrontendTool } from "../../types";
import { z } from "zod";
import { mountWithProvider } from "../../__tests__/utils/mount";
import { SequencedRunAgent, StateCapturingAgent, toolCallMessage } from "../../__tests__/utils/agents";

describe("useFrontendTool", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  const assistantMessage = (content: string, id = "assistant-msg"): Message =>
    ({
      id,
      role: "assistant",
      content,
    }) as Message;

  it("registers tool and executes it during agent run", async () => {
    const handler = vi.fn(async () => "ok");
    const tool = {
      name: "dynamicTool",
      description: "Dynamic",
      parameters: z.object({ x: z.number() }),
      handler,
      followUp: false,
    };

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(tool);
        return () => null;
      },
    });

    const agent = new StateCapturingAgent([{
      newMessages: [toolCallMessage("dynamicTool", { x: 42 })],
    }], "test-agent");

    const { getCore, wrapper } = mountWithProvider(
      () => h(ToolUser),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();
    await getCore().runAgent({ agent: agent as unknown as AbstractAgent });

    expect(handler).toHaveBeenCalledWith(
      { x: 42 },
      expect.objectContaining({
        toolCall: expect.objectContaining({
          function: expect.objectContaining({
            name: "dynamicTool",
            arguments: '{"x":42}',
          }),
        }),
        agent: expect.objectContaining({ agentId: "test-agent" }),
      }),
    );

    wrapper.unmount();
  });

  it("removes tool on unmount", async () => {
    const handler = vi.fn(async () => "ok");
    const tool = {
      name: "toolToRemove",
      description: "Remove",
      parameters: z.object({}),
      handler,
    };

    const Show = defineComponent({
      setup() {
        const shown = ref(true);
        return () =>
          h("div", [
            h("button", { "data-testid": "toggle", onClick: () => (shown.value = !shown.value) }, "toggle"),
            shown.value
              ? h(
                  defineComponent({
                    setup() {
                      useFrontendTool(tool);
                      return () => null;
                    },
                  }),
                )
              : null,
          ]);
      },
    });

    const agent = new StateCapturingAgent([{ newMessages: [] }], "test-agent");
    const { getCore, wrapper } = mountWithProvider(
      () => h(Show),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();
    expect(getCore().getTool({ toolName: "toolToRemove" })).toBeDefined();

    await wrapper.find("[data-testid=toggle]").trigger("click");
    await nextTick();

    expect(getCore().getTool({ toolName: "toolToRemove" })).toBeUndefined();
  });

  it("overrides existing tool and warns", async () => {
    const handler1 = vi.fn(async () => "one");
    const handler2 = vi.fn(async () => "two");

    const tool1 = {
      name: "sameTool",
      description: "One",
      parameters: z.object({}),
      handler: handler1,
      followUp: false,
    };
    const tool2 = {
      name: "sameTool",
      description: "Two",
      parameters: z.object({}),
      handler: handler2,
      followUp: false,
    };

    const Tool1User = defineComponent({
      setup() {
        useFrontendTool(tool1);
        return () => null;
      },
    });

    const Tool2User = defineComponent({
      setup() {
        useFrontendTool(tool2);
        return () => null;
      },
    });

    const Parent = defineComponent({
      setup() {
        const showSecond = ref(false);
        return () =>
          h("div", [
            h("button", { "data-testid": "show-second", onClick: () => (showSecond.value = true) }, "show"),
            h(Tool1User),
            showSecond.value ? h(Tool2User) : null,
          ]);
      },
    });

    const agent = new StateCapturingAgent([{ newMessages: [toolCallMessage("sameTool")] }], "test-agent");
    const { getCore, wrapper } = mountWithProvider(
      () => h(Parent),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();
    expect(getCore().getTool({ toolName: "sameTool" })?.handler).toBe(handler1);

    await wrapper.find("[data-testid=show-second]").trigger("click");
    await nextTick();
    await nextTick();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    await getCore().runAgent({ agent: agent as unknown as AbstractAgent });

    expect(handler2).toHaveBeenCalled();
    expect(handler1).not.toHaveBeenCalled();
  });

  it("executes wildcard tool when specific tool is missing", async () => {
    const handler = vi.fn(async () => "ok");
    const wildcardTool: VueFrontendTool<{ toolName: string; args: unknown }> = {
      name: "*",
      description: "Wildcard",
      handler,
      followUp: false,
    };

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(wildcardTool);
        return () => null;
      },
    });

    const agent = new StateCapturingAgent([{
      newMessages: [toolCallMessage("unknownTool", { message: "hi" })],
    }], "test-agent");

    const { getCore, wrapper } = mountWithProvider(
      () => h(ToolUser),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();
    await getCore().runAgent({ agent: agent as unknown as AbstractAgent });

    expect(handler).toHaveBeenCalledWith(
      { toolName: "unknownTool", args: { message: "hi" } },
      expect.anything(),
    );

    wrapper.unmount();
  });

  it("re-registers tool when dep sources change", async () => {
    const handler = vi.fn(async () => "ok");
    const tool: VueFrontendTool<Record<string, unknown>> = {
      name: "depTool",
      description: "Deps",
      parameters: z.object({}),
      handler,
      followUp: false,
    };
    const version = ref(0);

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(tool, [version]);
        return () => null;
      },
    });

    const agent = new StateCapturingAgent([{ newMessages: [] }], "test-agent");
    const { getCore } = mountWithProvider(
      () => h(ToolUser),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();
    const core = getCore();
    expect(core.getTool({ toolName: "depTool" })).toBeDefined();

    const addToolSpy = vi.spyOn(core, "addTool");
    version.value += 1;
    await nextTick();
    await nextTick();

    expect(addToolSpy).toHaveBeenCalled();
    expect(core.getTool({ toolName: "depTool" })).toBeDefined();
    addToolSpy.mockRestore();
  });

  it("registers a Vue component renderer when provided", async () => {
    const handler = vi.fn(async () => "ok");
    const ToolRenderer = defineComponent({
      props: {
        name: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          required: true,
        },
      },
      template: `<div data-testid="dynamic-tool-renderer">{{ name }}:{{ status }}</div>`,
    });
    const tool: VueFrontendTool<Record<string, unknown>> = {
      name: "componentTool",
      description: "Component renderer",
      parameters: z.object({}),
      handler,
      followUp: false,
      render: ToolRenderer,
    };

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(tool);
        return () => null;
      },
    });

    const agent = new StateCapturingAgent([{ newMessages: [] }], "test-agent");
    const { getCore } = mountWithProvider(
      () => h(ToolUser),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();

    const renderers = getCore().renderToolCalls;
    expect(renderers).toHaveLength(1);
    expect(renderers[0]?.name).toBe("componentTool");
    expect(renderers[0]?.render).toBe(ToolRenderer);
  });

  it("stops execution chain when followUp is false", async () => {
    const handler = vi.fn(async () => "done");
    const tool: VueFrontendTool<{ value: string }> = {
      name: "noFollowUpTool",
      description: "No follow up",
      parameters: z.object({ value: z.string() }),
      handler,
      followUp: false,
    };

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(tool);
        return () => null;
      },
    });

    const agent = new SequencedRunAgent([
      () => ({ newMessages: [toolCallMessage("noFollowUpTool", { value: "x" })] }),
      () => ({ newMessages: [assistantMessage("this should not run")] }),
    ], "test-agent");
    const runSpy = vi.spyOn(agent, "runAgent");

    const { getCore } = mountWithProvider(
      () => h(ToolUser),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();
    await getCore().runAgent({ agent: agent as unknown as AbstractAgent });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("continues execution chain when followUp is true or undefined", async () => {
    const explicitFollowUpHandler = vi.fn(async () => "continue");
    const defaultFollowUpHandler = vi.fn(async () => "continue-by-default");

    const explicitTool: VueFrontendTool<{ value: string }> = {
      name: "followUpTool",
      description: "Explicit follow up",
      parameters: z.object({ value: z.string() }),
      handler: explicitFollowUpHandler,
      followUp: true,
    };
    const defaultTool: VueFrontendTool<{ value: string }> = {
      name: "defaultFollowUpTool",
      description: "Default follow up",
      parameters: z.object({ value: z.string() }),
      handler: defaultFollowUpHandler,
    };

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(explicitTool);
        useFrontendTool(defaultTool);
        return () => null;
      },
    });

    const explicitAgent = new SequencedRunAgent([
      () => ({ newMessages: [toolCallMessage("followUpTool", { value: "x" })] }),
      () => ({ newMessages: [assistantMessage("follow-up explicit")] }),
    ], "test-agent");
    const explicitRunSpy = vi.spyOn(explicitAgent, "runAgent");

    const { getCore } = mountWithProvider(
      () => h(ToolUser),
      { agents__unsafe_dev_only: { "test-agent": explicitAgent as unknown as AbstractAgent } },
    );
    await nextTick();
    await getCore().runAgent({ agent: explicitAgent as unknown as AbstractAgent });
    expect(explicitRunSpy).toHaveBeenCalledTimes(2);
    expect(explicitFollowUpHandler).toHaveBeenCalledTimes(1);

    const defaultAgent = new SequencedRunAgent([
      () => ({ newMessages: [toolCallMessage("defaultFollowUpTool", { value: "y" })] }),
      () => ({ newMessages: [assistantMessage("follow-up default")] }),
    ], "test-agent");
    const defaultRunSpy = vi.spyOn(defaultAgent, "runAgent");
    await getCore().runAgent({ agent: defaultAgent as unknown as AbstractAgent });
    expect(defaultRunSpy).toHaveBeenCalledTimes(2);
    expect(defaultFollowUpHandler).toHaveBeenCalledTimes(1);
  });

  it("forwards registered frontend tools to run input", async () => {
    const dynamicTool: VueFrontendTool<{ x: number }> = {
      name: "dynamicForwarded",
      parameters: z.object({ x: z.number() }),
      handler: vi.fn(async () => "ok"),
      followUp: false,
    };
    const baseTool: VueFrontendTool<{ y: number }> = {
      name: "baseForwarded",
      parameters: z.object({ y: z.number() }),
      handler: vi.fn(async () => "ok"),
      followUp: false,
    };

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(dynamicTool);
        return () => null;
      },
    });

    const agent = new StateCapturingAgent([{ newMessages: [] }], "test-agent");
    const { getCore } = mountWithProvider(
      () => h(ToolUser),
      {
        frontendTools: [baseTool],
        agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent },
      },
    );

    await nextTick();
    await getCore().runAgent({ agent: agent as unknown as AbstractAgent });

    const toolNames = (agent.lastRunInput?.tools ?? []).map((tool) => tool.name);
    expect(toolNames).toContain("baseForwarded");
    expect(toolNames).toContain("dynamicForwarded");
  });

  it("dispatches agent-scoped tools only for matching agent", async () => {
    const scopedHandler = vi.fn(async () => "scoped");
    const globalHandler = vi.fn(async () => "global");

    const scopedTool: VueFrontendTool<{ a: number }> = {
      name: "sharedName",
      parameters: z.object({ a: z.number() }),
      handler: scopedHandler,
      followUp: false,
      agentId: "target-agent",
    };
    const globalTool: VueFrontendTool<{ a: number }> = {
      name: "sharedName",
      parameters: z.object({ a: z.number() }),
      handler: globalHandler,
      followUp: false,
    };

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(scopedTool);
        useFrontendTool(globalTool);
        return () => null;
      },
    });

    const targetAgent = new StateCapturingAgent([
      { newMessages: [toolCallMessage("sharedName", { a: 1 })] },
    ], "target-agent");
    const otherAgent = new StateCapturingAgent([
      { newMessages: [toolCallMessage("sharedName", { a: 2 })] },
    ], "other-agent");

    const { getCore } = mountWithProvider(
      () => h(ToolUser),
      {
        agents__unsafe_dev_only: {
          "target-agent": targetAgent as unknown as AbstractAgent,
          "other-agent": otherAgent as unknown as AbstractAgent,
        },
      },
    );

    await nextTick();
    await getCore().runAgent({ agent: targetAgent as unknown as AbstractAgent });
    await getCore().runAgent({ agent: otherAgent as unknown as AbstractAgent });

    expect(scopedHandler).toHaveBeenCalledTimes(1);
    expect(globalHandler).toHaveBeenCalledTimes(1);
    expect(scopedHandler).toHaveBeenCalledWith(
      { a: 1 },
      expect.objectContaining({ agent: expect.objectContaining({ agentId: "target-agent" }) }),
    );
    expect(globalHandler).toHaveBeenCalledWith(
      { a: 2 },
      expect.objectContaining({ agent: expect.objectContaining({ agentId: "other-agent" }) }),
    );
  });

  it("converts handler errors into tool error messages", async () => {
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const tool: VueFrontendTool<{ x: number }> = {
      name: "errorTool",
      parameters: z.object({ x: z.number() }),
      handler,
      followUp: false,
    };

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(tool);
        return () => null;
      },
    });

    const agent = new StateCapturingAgent([
      { newMessages: [toolCallMessage("errorTool", { x: 1 })] },
    ], "test-agent");

    const { getCore } = mountWithProvider(
      () => h(ToolUser),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();
    await expect(getCore().runAgent({ agent: agent as unknown as AbstractAgent })).resolves.toBeDefined();

    const toolMessage = agent.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("Error: boom");
  });

  it("throws on argument parse errors and does not call handler", async () => {
    const handler = vi.fn(async () => "ok");
    const tool: VueFrontendTool<{ x: number }> = {
      name: "parseTool",
      parameters: z.object({ x: z.number() }),
      handler,
      followUp: false,
    };

    const invalidToolCall: Message = {
      id: "bad-call",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "parseTool",
            arguments: "{not valid json",
          },
        },
      ],
    } as Message;

    const ToolUser = defineComponent({
      setup() {
        useFrontendTool(tool);
        return () => null;
      },
    });

    const agent = new StateCapturingAgent([{ newMessages: [invalidToolCall] }], "test-agent");

    const { getCore } = mountWithProvider(
      () => h(ToolUser),
      { agents__unsafe_dev_only: { "test-agent": agent as unknown as AbstractAgent } },
    );

    await nextTick();
    await expect(getCore().runAgent({ agent: agent as unknown as AbstractAgent })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
