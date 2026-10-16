import React, { StrictMode, useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RunAgentInput } from "@ag-ui/client";
import { GENERATIVE_UI_MARKDOWN_GUIDELINES } from "@copilotkit/shared";
import type {
  CopilotKitUIEnvelope,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useCopilotKit } from "../../context";
import { useFrontendTool } from "../../hooks/use-frontend-tool";
import {
  MockStepwiseAgent,
  runFinishedEvent,
  runStartedEvent,
  toolCallChunkEvent,
} from "../../__tests__/utils/test-helpers";
import { createGenerativeUI } from "../catalog";
import { useGenerativeUIFunction } from "../hooks";
import { useGenerativeUIRuntime } from "../runtime-context";
import type {
  GenerativeUIConfig,
  GenerativeUIRuntime,
} from "../runtime-context";

class CapturingAgent extends MockStepwiseAgent {
  static inputs: RunAgentInput[] = [];
  run(input: RunAgentInput) {
    CapturingAgent.inputs.push(input);
    return super.run(input);
  }
}

const ui = createGenerativeUI({
  id: "shop",
  functions: {
    applyCoupon: { parameters: z.object({ code: z.string() }) },
  },
  components: {
    Box: { component: () => null },
    Button: {
      component: () => null,
      props: z.object({ label: z.string() }),
    },
  },
});

type CouponHandler = (args: { code: string }) => unknown;
type CopilotKit = ReturnType<typeof useCopilotKit>["copilotkit"];

function Coupon({ handler }: { handler: CouponHandler }) {
  useGenerativeUIFunction(ui, "applyCoupon", handler);
  return null;
}

function setup(config: GenerativeUIConfig = { ui }) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  const other = new CapturingAgent();
  const captured: {
    runtime?: GenerativeUIRuntime | null;
    copilotkit?: CopilotKit;
  } = {};
  function Probe() {
    captured.runtime = useGenerativeUIRuntime();
    captured.copilotkit = useCopilotKit().copilotkit;
    return null;
  }
  // StrictMode mounts, unmounts and mounts the handler hook's effect again.
  const tree = (handler?: CouponHandler) => (
    <CopilotKitProvider
      agents__unsafe_dev_only={{ default: agent, other }}
      generativeUI={config}
    >
      <Probe />
      {handler && (
        <StrictMode>
          <Coupon handler={handler} />
        </StrictMode>
      )}
    </CopilotKitProvider>
  );
  const { rerender, unmount } = render(tree());
  return {
    agent,
    other,
    runtime: captured.runtime!,
    copilotkit: captured.copilotkit!,
    setHandler: (handler?: CouponHandler) => rerender(tree(handler)),
    unmount,
  };
}

/** Runs `agent` once to the end. Returns the input of that run. */
async function runOnce(copilotkit: CopilotKit, agent: CapturingAgent) {
  const index = CapturingAgent.inputs.length;
  const pending = copilotkit.runAgent({ agent });
  await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(index + 1));
  agent.emit(runStartedEvent());
  agent.emit(runFinishedEvent());
  await pending;
  return CapturingAgent.inputs[index];
}

function envelopeOf(input: RunAgentInput): CopilotKitUIEnvelope | undefined {
  return input.forwardedProps?.copilotkit?.ui;
}

function buttonSurface(surfaceId: string): GenerativeUISurfaceContent {
  return {
    surfaceId,
    target: "chat",
    catalogId: "shop",
    status: "ready",
    rejected: [],
    operations: [
      { version: "v0.9", createSurface: { surfaceId, catalogId: "shop" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId,
          components: [{ id: "root", component: "Button", label: "Buy now" }],
        },
      },
    ],
  };
}

const origin = { surfaceId: "s1", componentId: "root" };

afterEach(() => vi.restoreAllMocks());

describe("useGenerativeUIRoot", () => {
  it("exposes a declared function only while a handler is mounted", async () => {
    const { runtime, setHandler } = setup();
    const invoke = () =>
      runtime.dispatcher.invoke("applyCoupon", { code: "SAVE" }, origin);
    expect(runtime.dispatcher.listExposed()).toEqual({});
    const before = await invoke();
    expect(!before.ok && before.error.code).toBe("function_not_found");

    setHandler(() => "applied");
    expect(Object.keys(runtime.dispatcher.listExposed())).toEqual([
      "applyCoupon",
    ]);
    await expect(invoke()).resolves.toEqual({ ok: true, result: "applied" });

    setHandler(undefined);
    expect(runtime.dispatcher.listExposed()).toEqual({});
    const after = await invoke();
    expect(!after.ok && after.error.code).toBe("function_not_found");
  });

  it("runs the latest handler closure and keeps one registration across re-renders and StrictMode remounts", async () => {
    const { runtime, setHandler } = setup();
    const first = vi.fn(() => "first");
    const latest = vi.fn(() => "latest");
    setHandler(first);
    setHandler(latest);

    const result = await runtime.dispatcher.invoke(
      "applyCoupon",
      { code: "SAVE" },
      origin,
    );

    // Two registrations would give `function_conflict`.
    expect(result).toEqual({ ok: true, result: "latest" });
    expect(latest).toHaveBeenCalledExactlyOnceWith({ code: "SAVE" });
    expect(first).not.toHaveBeenCalled();
  });

  it("reportError never throws when the host onError throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn((_info: unknown) => {
      throw new Error("host boom");
    });
    const { runtime } = setup({ ui, errorBoundary: { onError } });

    expect(() =>
      runtime.reportError({
        kind: "render",
        surfaceId: "s1",
        error: new Error("render failed"),
      }),
    ).not.toThrow();

    // A rejected operation reports from inside ingestion, which must survive too.
    const content: GenerativeUISurfaceContent = {
      ...buttonSurface("s1"),
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
      ],
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

  describe("envelope", () => {
    it("sends the tool envelope with the components and no instructions", async () => {
      const { copilotkit, agent } = setup();

      const envelope = envelopeOf(await runOnce(copilotkit, agent));

      expect(envelope).toEqual({
        method: "a2ui",
        version: "v0.9",
        format: 2,
        transport: "tool",
        catalog: {
          id: "shop",
          version: expect.stringMatching(/^fnv1a:[0-9a-f]{8}$/),
          components: {
            Box: expect.any(Object),
            Button: expect.any(Object),
          },
        },
        functions: {},
        targets: [{ id: "chat", kind: "chat" }],
        surfaces: {},
        contextSent: false,
      });
    });

    it("sends the markdown envelope with the guideline, and with the components by default", async () => {
      const { copilotkit, agent } = setup({ ui, transport: "markdown" });

      const envelope = envelopeOf(await runOnce(copilotkit, agent));

      expect(envelope).toMatchObject({
        transport: "markdown",
        instructions: GENERATIVE_UI_MARKDOWN_GUIDELINES,
        contextSent: true,
      });
      expect(Object.keys(envelope?.catalog.components ?? {})).toEqual([
        "Box",
        "Button",
      ]);
    });

    it("leaves out the components and marks the context as not sent when the markdown options turn them off", async () => {
      const { copilotkit, agent } = setup({
        ui,
        transport: "markdown",
        includeCatalog: false,
        sendContext: false,
      });

      const envelope = envelopeOf(await runOnce(copilotkit, agent));

      expect(envelope?.catalog).toEqual({
        id: "shop",
        version: expect.stringMatching(/^fnv1a:/),
      });
      expect(envelope?.contextSent).toBe(false);
    });

    it("sends the envelope only to the agents in agentIds", async () => {
      const { copilotkit, agent, other } = setup({
        ui,
        agentIds: ["default"],
      });

      const listed = await runOnce(copilotkit, agent);
      const unlisted = await runOnce(copilotkit, other);

      expect(envelopeOf(listed)?.catalog.id).toBe("shop");
      expect(unlisted.forwardedProps).not.toHaveProperty("copilotkit");
    });

    it("removes the envelope on unmount", async () => {
      const { copilotkit, agent, unmount } = setup();
      await runOnce(copilotkit, agent);
      expect(copilotkit.getPropertiesForAgent("default")).toHaveProperty(
        "copilotkit",
      );

      unmount();

      expect(copilotkit.getPropertiesForAgent("default")).toEqual({});
    });

    it("keeps the envelope on a tool follow-up run after the provider re-renders with new properties", async () => {
      CapturingAgent.inputs = [];
      const agent = new CapturingAgent();
      let copilotkit!: CopilotKit;

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
            generativeUI={{ ui }}
          >
            <SwitchUserTool onSwitch={() => setUserId("b")} />
          </CopilotKitProvider>
        );
      }
      render(<Host />);

      void copilotkit.runAgent({ agent });
      await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      expect(envelopeOf(CapturingAgent.inputs[0])?.catalog.id).toBe("shop");

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

      // Follow-up runs do not fire onAgentRunStarted. The envelope is a
      // scoped entry, so new provider properties do not replace it.
      await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(2));
      const followUp = CapturingAgent.inputs[1];
      expect(followUp.forwardedProps.userId).toBe("b");
      expect(envelopeOf(followUp)?.catalog.id).toBe("shop");
    });
  });

  describe("forwardEvent", () => {
    it("adds the event as a user message with the label of its component, then runs the agent", async () => {
      const { runtime, agent } = setup();
      act(() =>
        runtime.manager.ingest(agent.threadId, "default", buttonSurface("s1")),
      );

      const pending = runtime.forwardEvent(
        { name: "buy", ...origin, context: { sku: "a" } },
        "default",
      );
      await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());

      await expect(pending).resolves.toEqual({ ok: true, result: undefined });
      expect(CapturingAgent.inputs[0].messages.at(-1)).toMatchObject({
        role: "user",
        content: "Buy now\n\nsku: a",
      });
    });

    it("reports event_forward_failed when the agent does not exist", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const onError = vi.fn();
      const { runtime } = setup({ ui, errorBoundary: { onError } });

      const result = await runtime.forwardEvent(
        { name: "buy", ...origin, context: {} },
        "missing",
      );

      expect(!result.ok && result.error.code).toBe("event_forward_failed");
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "event", surfaceId: "s1" }),
      );
      expect(CapturingAgent.inputs).toHaveLength(0);
    });
  });
});
