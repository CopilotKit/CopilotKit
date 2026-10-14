import React, { useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RunAgentInput } from "@ag-ui/client";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useCopilotKit } from "../../context";
import { useFrontendTool } from "../../hooks/use-frontend-tool";
import {
  MockStepwiseAgent,
  runFinishedEvent,
  runStartedEvent,
  toolCallChunkEvent,
} from "../../__tests__/utils/test-helpers";
import { createGenerativeUICatalog } from "../catalog";
import { useGenerativeUIRuntime } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import type { GenerativeUIConfig } from "../use-generative-ui-root";

class CapturingAgent extends MockStepwiseAgent {
  static inputs: RunAgentInput[] = [];
  run(input: RunAgentInput) {
    CapturingAgent.inputs.push(input);
    return super.run(input);
  }
}

const catalog = createGenerativeUICatalog({
  id: "shop",
  components: { Box: { component: () => null } },
});

function setup(config: Omit<GenerativeUIConfig, "catalog"> = {}) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  const handler = vi.fn(async () => "ok");
  const captured: {
    runtime?: GenerativeUIRuntime | null;
    copilotkit?: ReturnType<typeof useCopilotKit>["copilotkit"];
  } = {};
  function Probe() {
    useFrontendTool({
      name: "applyCoupon",
      parameters: z.object({}),
      handler,
      exposeToGenerativeUI: true,
    });
    captured.runtime = useGenerativeUIRuntime();
    captured.copilotkit = useCopilotKit().copilotkit;
    return null;
  }
  render(
    <CopilotKitProvider
      agents__unsafe_dev_only={{ default: agent }}
      generativeUI={{ catalog, ...config }}
    >
      <Probe />
    </CopilotKitProvider>,
  );
  return {
    agent,
    handler,
    runtime: captured.runtime!,
    copilotkit: captured.copilotkit!,
  };
}

const origin = { surfaceId: "s1", componentId: "root" };

afterEach(() => vi.restoreAllMocks());

describe("useGenerativeUIRoot", () => {
  it("treats a tool disabled via setToolEnabled as not exposed", async () => {
    const { runtime, copilotkit, handler } = setup();
    await waitFor(() =>
      expect(Object.keys(runtime.dispatcher.listExposed())).toEqual([
        "applyCoupon",
      ]),
    );

    copilotkit.setToolEnabled("applyCoupon", false);

    expect(runtime.dispatcher.listExposed()).toEqual({});
    const result = await runtime.dispatcher.invoke("applyCoupon", {}, origin);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("function_not_exposed");
    expect(handler).not.toHaveBeenCalled();
  });

  it("reportError never throws when the host onError throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn((_info: unknown) => {
      throw new Error("host boom");
    });
    const { runtime } = setup({ errorBoundary: { onError } });

    expect(() =>
      runtime.reportError({
        kind: "render",
        surfaceId: "s1",
        error: new Error("render failed"),
      }),
    ).not.toThrow();

    // A rejected operation reports from inside ingestion, which must survive too.
    const content: GenerativeUISurfaceContent = {
      surfaceId: "s1",
      target: "chat",
      catalogId: "shop",
      status: "ready",
      rejected: [],
      operations: [
        {
          version: "v0.9",
          createSurface: { surfaceId: "s1", catalogId: "shop" },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s1",
            components: [{ id: "root", component: "Missing" }],
          },
        },
      ] as GenerativeUISurfaceContent["operations"],
    };
    expect(() =>
      runtime.manager.ingest("t1", "default", content),
    ).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[1][0]).toMatchObject({
      kind: "operation",
      surfaceId: "s1",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[generativeUI] errorBoundary.onError threw:",
      expect.objectContaining({ message: "host boom" }),
    );
  });

  it("forwards a user event on that run only, without leaving it in provider properties", async () => {
    const { runtime, copilotkit, agent } = setup();
    const event = {
      name: "picked",
      surfaceId: "s1",
      componentId: "root",
      context: { sku: "a" },
    };

    const pending = runtime.forwardEvent(event, "default");
    await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));

    expect(CapturingAgent.inputs[0].forwardedProps.generativeUIAction).toEqual(
      event,
    );
    expect(CapturingAgent.inputs[0].forwardedProps.generativeUI.catalogId).toBe(
      "shop",
    );
    expect(copilotkit.properties).not.toHaveProperty("generativeUIAction");

    agent.emit(runStartedEvent({ threadId: agent.threadId, runId: "r1" }));
    agent.emit(runFinishedEvent({ threadId: agent.threadId, runId: "r1" }));
    await expect(pending).resolves.toEqual({ ok: true, result: undefined });
  });

  it("keeps the manifest on a tool follow-up run after the provider re-renders with new properties", async () => {
    CapturingAgent.inputs = [];
    const agent = new CapturingAgent();
    let copilotkit!: ReturnType<typeof useCopilotKit>["copilotkit"];

    function SwitchUserTool({ onSwitch }: { onSwitch: () => void }) {
      copilotkit = useCopilotKit().copilotkit;
      useFrontendTool({
        name: "switchUser",
        parameters: z.object({}),
        followUp: true,
        // Commit the host re-render (and the provider's properties effect)
        // before core starts the follow-up run.
        handler: async () => {
          await act(async () => onSwitch());
        },
      });
      return null;
    }
    function Host() {
      const [userId, setUserId] = useState("a");
      return (
        // Inline objects on purpose: every re-render hands the provider a new `properties`.
        <CopilotKitProvider
          agents__unsafe_dev_only={{ default: agent }}
          properties={{ userId }}
          generativeUI={{ catalog }}
        >
          <SwitchUserTool onSwitch={() => setUserId("b")} />
        </CopilotKitProvider>
      );
    }
    render(<Host />);

    void copilotkit.runAgent({ agent: copilotkit.getAgent("default")! });
    await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
    expect(CapturingAgent.inputs[0].forwardedProps.generativeUI.catalogId).toBe(
      "shop",
    );

    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId: "tc1",
        toolCallName: "switchUser",
        parentMessageId: "m1",
        delta: "{}",
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // Follow-up runs do not fire onAgentRunStarted, so the manifest must survive
    // the provider replacing its properties in between.
    await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(2));
    const followUp = CapturingAgent.inputs[1].forwardedProps;
    expect(followUp.userId).toBe("b");
    expect(followUp.generativeUI?.catalogId).toBe("shop");
  });

  it("drops the manifest when generativeUI is removed, even as properties change", async () => {
    const agent = new CapturingAgent();
    let copilotkit!: ReturnType<typeof useCopilotKit>["copilotkit"];
    function Probe() {
      copilotkit = useCopilotKit().copilotkit;
      return null;
    }
    const tree = (userId: string, withGenerativeUI: boolean) => (
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        properties={{ userId }}
        generativeUI={withGenerativeUI ? { catalog } : undefined}
      >
        <Probe />
      </CopilotKitProvider>
    );
    const { rerender } = render(tree("a", true));
    void copilotkit.runAgent({ agent: copilotkit.getAgent("default")! });
    await waitFor(() =>
      expect(copilotkit.properties).toHaveProperty("generativeUI"),
    );
    agent.emit(runStartedEvent());
    agent.emit(runFinishedEvent());

    rerender(tree("b", true));
    expect(copilotkit.properties).toMatchObject({
      userId: "b",
      generativeUI: { catalogId: "shop" },
    });

    rerender(tree("c", false));
    expect(copilotkit.properties).toEqual({ userId: "c" });
  });
});
