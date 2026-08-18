import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, isVNode, nextTick, reactive, ref } from "vue";
import { getZodParameters } from "@copilotkit/shared";

vi.mock("../../v2/hooks/use-frontend-tool", () => ({
  useFrontendTool: vi.fn(),
}));
vi.mock("../../v2/hooks/use-human-in-the-loop", () => ({
  useHumanInTheLoop: vi.fn(),
}));
vi.mock("../../v2/hooks/use-render-tool", () => ({
  useRenderTool: vi.fn(),
}));

import { useFrontendTool as useFrontendToolV2 } from "../../v2/hooks/use-frontend-tool";
import { useHumanInTheLoop as useHumanInTheLoopV2 } from "../../v2/hooks/use-human-in-the-loop";
import { useRenderTool as useRenderToolV2 } from "../../v2/hooks/use-render-tool";
import { useCopilotAction } from "../use-copilot-action";
import { useFrontendTool } from "../use-frontend-tool";

const frontendTool = vi.mocked(useFrontendToolV2);
const humanInTheLoop = vi.mocked(useHumanInTheLoopV2);
const renderTool = vi.mocked(useRenderToolV2);

const render = vi.fn((props: unknown) => props);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCopilotAction v1 compatibility", () => {
  it.each([
    {
      label: "catch-all",
      action: { name: "*", render },
      target: "render",
    },
    {
      label: "HITL property presence, including explicit undefined",
      action: { name: "confirm", renderAndWaitForResponse: undefined },
      target: "hitl",
    },
    {
      label: "enabled availability",
      action: { name: "enabled", available: "enabled", render },
      target: "frontend",
    },
    {
      label: "remote availability",
      action: { name: "remote", available: "remote", render },
      target: "frontend",
    },
    {
      label: "frontend availability",
      action: { name: "frontend", available: "frontend", render },
      target: "render",
    },
    {
      label: "disabled availability",
      action: { name: "disabled", available: "disabled", render },
      target: "render",
    },
    {
      label: "handler presence",
      action: { name: "handler", handler: () => "done" },
      target: "frontend",
    },
  ])("routes $label with React precedence", ({ action, target }) => {
    useCopilotAction(action as never);

    expect(
      target === "frontend"
        ? frontendTool
        : target === "hitl"
          ? humanInTheLoop
          : renderTool,
    ).toHaveBeenCalledTimes(1);
    expect(
      [frontendTool, humanInTheLoop, renderTool].filter(
        (mock) => mock.mock.calls.length > 0,
      ),
    ).toHaveLength(1);
  });

  it("gives HITL precedence over availability and handler", () => {
    useCopilotAction({
      name: "confirm",
      available: "frontend",
      handler: () => "ignored",
      renderAndWaitForResponse: render,
    } as never);

    expect(humanInTheLoop).toHaveBeenCalledTimes(1);
    expect(frontendTool).not.toHaveBeenCalled();
    expect(renderTool).not.toHaveBeenCalled();
  });

  it("throws for an invalid action configuration", () => {
    expect(() => useCopilotAction({ name: "invalid" } as never)).toThrow(
      new Error("Invalid action configuration"),
    );
  });

  it("forwards schema, description, followUp, dependencies, and remote=true", () => {
    const parameters = [{ name: "city", type: "string" as const }];
    const dependencies = [ref("one")];
    const handler = vi.fn(() => "done");

    useCopilotAction(
      {
        name: "lookup",
        description: "Look up a city",
        parameters,
        handler,
        followUp: true,
        available: "remote",
        render,
      },
      dependencies,
    );

    expect(frontendTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "lookup",
        description: "Look up a city",
        followUp: true,
        available: true,
      }),
      dependencies,
    );
    const registered = frontendTool.mock.calls[0][0];
    expect(registered.parameters?.safeParse({ city: "Vienna" }).success).toBe(
      true,
    );
    expect(registered.handler).toBeTypeOf("function");
  });

  it("registers parameterless render-only actions with the empty schema", () => {
    useCopilotAction({ name: "render", available: "frontend", render });

    const registered = renderTool.mock.calls[0][0];
    expect(registered.parameters?.safeParse({}).success).toBe(
      getZodParameters(undefined).safeParse({}).success,
    );
    expect(registered.parameters?.safeParse({}).success).toBe(true);
  });

  it("registers an explicit undefined HITL renderer as a no-op", () => {
    useCopilotAction({
      name: "confirm",
      renderAndWaitForResponse: undefined,
    } as never);

    const registered = humanInTheLoop.mock.calls[0][0];
    expect(registered.render).toBeTypeOf("function");
    expect(
      (registered.render as (props: unknown) => unknown)({
        status: "inProgress",
        args: {},
        result: undefined,
      }),
    ).toBeNull();
  });

  it("forwards current HITL metadata and normalizes status, result, handler, and respond", async () => {
    const parameters = [{ name: "reason", type: "string" as const }];
    const dependencies = [ref(0)];
    const renderer = vi.fn(() => "hitl");

    useCopilotAction(
      {
        name: "confirm",
        description: "Confirm an action",
        parameters,
        followUp: true,
        renderAndWaitForResponse: renderer,
      },
      dependencies,
    );

    expect(humanInTheLoop).toHaveBeenCalledWith(
      expect.anything(),
      dependencies,
    );

    const registered = humanInTheLoop.mock.calls[0][0];
    expect(registered).toEqual(
      expect.objectContaining({
        name: "confirm",
        description: "Confirm an action",
        followUp: true,
      }),
    );
    expect(registered.parameters.safeParse({ reason: "yes" }).success).toBe(
      true,
    );

    const inProgress = registered.render({
      status: "inProgress",
      args: {},
      result: undefined,
    } as never);
    expect(inProgress).toBe("hitl");
    expect(renderer).toHaveBeenLastCalledWith({
      args: {},
      respond: undefined,
      status: "inProgress",
      handler: undefined,
      result: undefined,
    });

    const respond = vi.fn();
    registered.render({
      status: "executing",
      args: { reason: "yes" },
      result: undefined,
      respond,
    } as never);
    expect(renderer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "executing",
        handler: expect.any(Function),
        respond,
        result: undefined,
      }),
    );

    registered.render({
      status: "complete",
      args: { reason: "yes" },
      result: '{"approved":true}',
    } as never);
    expect(renderer).toHaveBeenLastCalledWith({
      args: { reason: "yes" },
      respond: undefined,
      status: "complete",
      handler: undefined,
      result: { approved: true },
    });
  });

  it("reads the latest HITL renderer through the v1 route", () => {
    const firstRenderer = vi.fn(() => "first");
    const latestRenderer = vi.fn(() => "latest");
    const action = {
      name: "latest-confirm",
      renderAndWaitForResponse: firstRenderer,
    };

    useCopilotAction(action as never);
    action.renderAndWaitForResponse = latestRenderer;

    const registered = humanInTheLoop.mock.calls[0][0];
    expect(
      registered.render({
        status: "executing",
        args: {},
        result: undefined,
        respond: vi.fn(),
      } as never),
    ).toBe("latest");
    expect(firstRenderer).not.toHaveBeenCalled();
  });

  it("normalizes component props for frontend and render-only results", () => {
    const Renderer = defineComponent({
      props: { result: { type: null, required: false } },
      setup(props) {
        return () => h("div", JSON.stringify(props.result));
      },
    });

    useCopilotAction({
      name: "component-frontend",
      available: "enabled",
      render: Renderer,
    } as never);
    const frontendRenderer = frontendTool.mock.calls[0][0].render;
    const frontendVNode = frontendRenderer?.({
      result: '{"ok":true}',
    });
    expect(isVNode(frontendVNode)).toBe(true);
    expect(frontendVNode?.props?.result).toEqual({ ok: true });

    useCopilotAction({
      name: "component-render-only",
      available: "frontend",
      render: Renderer,
    } as never);
    const renderOnlyRenderer = renderTool.mock.calls[0][0].render;
    const renderOnlyVNode = renderOnlyRenderer({
      result: '{"ok":true}',
    });
    expect(isVNode(renderOnlyVNode)).toBe(true);
    expect(renderOnlyVNode?.props?.result).toEqual({ ok: true });
  });

  it("parses only truthy catch-all results", () => {
    const wildcardRenderer = vi.fn((props: unknown) => props);
    useCopilotAction({ name: "*", render: wildcardRenderer } as never);

    const registered = renderTool.mock.calls[0][0];
    registered.render({ result: '{"ok":true}' });
    expect(wildcardRenderer).toHaveBeenLastCalledWith({
      result: { ok: true },
    });
    registered.render({ result: "" });
    expect(wildcardRenderer).toHaveBeenLastCalledWith({ result: "" });
  });

  it("accepts but does not consume disabled and pairedAction", () => {
    useCopilotAction({
      name: "compat-fields",
      disabled: true,
      pairedAction: "other-action",
      handler: () => "done",
    } as never);
    expect(frontendTool.mock.calls[0][0]).not.toHaveProperty("disabled");
    expect(frontendTool.mock.calls[0][0]).not.toHaveProperty("pairedAction");

    useCopilotAction({
      name: "compat-render-fields",
      available: "disabled",
      disabled: true,
      pairedAction: "other-action",
      render,
    } as never);
    expect(renderTool.mock.calls[0][0]).not.toHaveProperty("disabled");
    expect(renderTool.mock.calls[0][0]).not.toHaveProperty("pairedAction");
  });

  it("does not forward v1 agentId through either v1 adapter", () => {
    useCopilotAction({
      name: "runtime-agent-action",
      handler: () => "done",
      agentId: "agent-1",
    } as never);
    expect(frontendTool.mock.calls[0][0]).not.toHaveProperty("agentId");

    useFrontendTool({
      name: "runtime-agent-tool",
      handler: () => "done",
      agentId: "agent-1",
    } as never);
    expect(frontendTool.mock.calls[1][0]).not.toHaveProperty("agentId");
  });

  it("reads updated reactive action fields through useCopilotAction", () => {
    const firstHandler = vi.fn(() => "first");
    const latestHandler = vi.fn(() => "latest");
    const firstRenderer = vi.fn(() => "first-render");
    const latestRenderer = vi.fn(() => "latest-render");
    const action = reactive({
      name: "latest-action",
      available: "enabled" as const,
      handler: firstHandler,
      render: firstRenderer,
    });

    useCopilotAction(action as never);
    action.handler = latestHandler;
    action.render = latestRenderer;

    const registered = frontendTool.mock.calls[0][0];
    expect(registered.handler?.({})).toBe("latest");
    expect(
      registered.render?.({
        result: undefined,
      }),
    ).toBe("latest-render");
    expect(firstHandler).not.toHaveBeenCalled();
    expect(firstRenderer).not.toHaveBeenCalled();
  });

  it("reads current plain-object fields when a dependency triggers registration", () => {
    const dependency = ref(0);
    const action = {
      name: "dependency-action",
      available: "enabled" as const,
      description: "before",
      parameters: [{ name: "before", type: "string" as const }],
      followUp: false,
      handler: () => "before",
      render: () => "before-render",
    };

    useCopilotAction(action as never, [dependency]);
    action.description = "after";
    action.parameters = [{ name: "after", type: "number" as const }];
    action.followUp = true;
    action.handler = () => "after";
    action.render = () => "after-render";
    dependency.value++;

    const registered = frontendTool.mock.calls[0][0];
    expect(registered.description).toBe("after");
    expect(registered.followUp).toBe(true);
    expect(registered.parameters.safeParse({ after: 1 }).success).toBe(true);
    expect(registered.handler?.({})).toBe("after");
    expect(registered.render?.({ result: undefined })).toBe("after-render");
  });

  it("throws the React configuration-change error synchronously for reactive classifier changes", async () => {
    const action = reactive({
      name: "dynamic",
      handler: () => "done",
    });

    useCopilotAction(action, []);
    expect(() => {
      action.available = "frontend";
      action.handler = undefined;
    }).toThrow(new Error("Action configuration changed between renders"));

    await nextTick();
  });

  it("checks configuration changes when a dependency changes", () => {
    const action = { name: "dynamic", handler: () => "done" } as {
      name: string;
      handler?: () => string;
      available?: "frontend";
    };
    const dependency = ref(0);

    useCopilotAction(action, [dependency]);
    action.available = "frontend";
    expect(() => {
      dependency.value++;
    }).toThrow(new Error("Action configuration changed between renders"));
  });
});

describe("useFrontendTool v1 compatibility", () => {
  it("forwards the latest handler and render behavior with dependencies", async () => {
    const dependency = ref(0);
    const handler = vi.fn(() => "handled");
    const renderer = vi.fn(
      ({ result }: { result?: unknown }) => result ?? null,
    );

    useFrontendTool(
      {
        name: "tool",
        description: "Tool",
        handler,
        render: renderer,
        followUp: true,
        available: "enabled",
      },
      [dependency],
    );

    const registered = frontendTool.mock.calls[0][0];
    expect(frontendTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tool",
        description: "Tool",
        followUp: true,
        available: true,
      }),
      [dependency],
    );
    await expect(Promise.resolve(registered.handler?.({}))).resolves.toBe(
      "handled",
    );
    expect(
      registered.render?.({
        name: "tool",
        toolCallId: "call",
        args: {},
        status: "complete",
        result: '{"ok":true}',
      } as never),
    ).toEqual({ ok: true });
  });

  it("reads updated reactive handler and renderer fields", () => {
    const firstHandler = vi.fn(() => "first");
    const latestHandler = vi.fn(() => "latest");
    const firstRenderer = vi.fn(() => "first-render");
    const latestRenderer = vi.fn(() => "latest-render");
    const tool = reactive({
      name: "latest-tool",
      handler: firstHandler,
      render: firstRenderer,
    });

    useFrontendTool(tool as never);
    tool.handler = latestHandler;
    tool.render = latestRenderer;

    const registered = frontendTool.mock.calls[0][0];
    expect(registered.handler?.({})).toBe("latest");
    expect(
      registered.render?.({
        name: "latest-tool",
        toolCallId: "call",
        args: {},
        status: "executing",
        result: undefined,
      } as never),
    ).toBe("latest-render");
    expect(firstHandler).not.toHaveBeenCalled();
    expect(firstRenderer).not.toHaveBeenCalled();
  });
});
