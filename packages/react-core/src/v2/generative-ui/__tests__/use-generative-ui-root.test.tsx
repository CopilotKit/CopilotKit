import React, { StrictMode, useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import type { RunAgentInput } from "@ag-ui/client";
import {
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
  buildGenerativeUIMarkdownGuidelines,
  buildGenerativeUIPrompt,
  envelopeToManifest,
  randomUUID,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
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
import { createGenerativeUI } from "../catalog";
import { createGenerativeUIDispatcher } from "../dispatcher";
import { GenerativeUISurfaceManager } from "../surface-manager";
import { buildGenerativeUIManifest } from "../manifest";
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

/** The guideline for this UI: no events, no multiple slot, and no function mounted. */
const SMALL_GUIDELINE = buildGenerativeUIMarkdownGuidelines({
  functions: false,
  events: false,
  templates: false,
  checks: false,
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

/** The envelope of a run, read the way the runtime reads it. */
function envelopeOf(input: RunAgentInput) {
  return readCopilotKitUIEnvelope(input.forwardedProps);
}

/** The one inline catalog of the envelope of a run. */
function catalogOf(input: RunAgentInput) {
  return envelopeOf(input)?.["v1.0"].inlineCatalogs?.[0];
}

function buttonSurface(surfaceId: string): GenerativeUISurfaceContent {
  return {
    surfaceId,
    target: "chat",
    catalogId: "shop",
    status: "ready",
    rejected: [],
    operations: [
      { version: "v1.0", createSurface: { surfaceId, catalogId: "shop" } },
      {
        version: "v1.0",
        updateComponents: {
          surfaceId,
          components: [{ id: "root", component: "Button", label: "Buy now" }],
        },
      },
    ],
  };
}

/** A surface whose root is a component that the catalog does not have. */
function missingRootSurface(surfaceId: string): GenerativeUISurfaceContent {
  return {
    ...buttonSurface(surfaceId),
    operations: [
      { version: "v1.0", createSurface: { surfaceId, catalogId: "shop" } },
      {
        version: "v1.0",
        updateComponents: {
          surfaceId,
          components: [{ id: "root", component: "Missing" }],
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
    expect(() =>
      runtime.manager.ingest("t1", "default", missingRootSurface("s1")),
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
    it("sends the tool envelope in the v1.0 capabilities shape, with the components and no instructions", async () => {
      const { copilotkit, agent } = setup();

      const envelope = envelopeOf(await runOnce(copilotkit, agent));

      expect(envelope).toStrictEqual({
        "v1.0": {
          supportedCatalogIds: ["shop"],
          inlineCatalogs: [
            {
              catalogId: "shop",
              protocolVersion: "1.0",
              components: {
                Box: expect.any(Object),
                Button: expect.any(Object),
              },
              functions: expect.objectContaining({
                formatCurrency: expect.any(Object),
              }),
            },
          ],
        },
        metadata: {
          extensions: {
            copilotkit_format: 3,
            copilotkit_transport: "tool",
            copilotkit_targets: [{ id: "chat", kind: "chat" }],
            copilotkit_surfaces: {},
            copilotkit_contextSent: false,
          },
        },
      });
    });

    it("sends an envelope that the runtime turns back into the manifest of the client", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { copilotkit, agent, runtime, setHandler } = setup();
      setHandler(() => "applied");
      act(() =>
        runtime.manager.ingest(
          agent.threadId,
          "default",
          missingRootSurface("s1"),
        ),
      );

      const envelope = envelopeOf(await runOnce(copilotkit, agent));

      expect(envelope && envelopeToManifest(envelope)).toEqual({
        catalogId: "shop",
        components: {
          Box: expect.any(Object),
          Button: {
            props: expect.objectContaining({
              properties: {
                label: expect.objectContaining({ type: "string" }),
              },
            }),
          },
        },
        functions: expect.objectContaining({
          applyCoupon: {
            parameters: expect.objectContaining({
              properties: { code: expect.objectContaining({ type: "string" }) },
            }),
          },
          formatCurrency: expect.any(Object),
        }),
        targets: [{ id: "chat", kind: "chat" }],
        surfaces: {
          s1: {
            target: "chat",
            rejected: [
              'operation 1: component "root": unknown component "Missing"',
            ],
          },
        },
        transport: "tool",
        contextSent: false,
        instructions: undefined,
        hasComponents: true,
      });
    });

    it("sends the markdown envelope with the guideline, and with the components by default", async () => {
      const { copilotkit, agent } = setup({ ui, transport: "markdown" });

      const input = await runOnce(copilotkit, agent);

      expect(envelopeOf(input)?.metadata.extensions).toMatchObject({
        copilotkit_transport: "markdown",
        copilotkit_contextSent: true,
      });
      expect(catalogOf(input)?.instructions).toBe(SMALL_GUIDELINE);
      expect(Object.keys(catalogOf(input)?.components ?? {})).toEqual([
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

      const input = await runOnce(copilotkit, agent);

      expect(catalogOf(input)).toStrictEqual({
        catalogId: "shop",
        protocolVersion: "1.0",
        functions: expect.objectContaining({
          formatCurrency: expect.any(Object),
        }),
        instructions: SMALL_GUIDELINE,
      });
      expect(
        envelopeOf(input)?.metadata.extensions.copilotkit_contextSent,
      ).toBe(false);
    });

    it("adds the function rules to the markdown guideline only while a function is mounted", async () => {
      const { copilotkit, agent, setHandler } = setup({
        ui,
        transport: "markdown",
      });

      const before = await runOnce(copilotkit, agent);
      setHandler(() => "ok");
      const after = await runOnce(copilotkit, agent);

      expect(catalogOf(before)?.instructions).not.toContain(
        "callRendererFunction",
      );
      expect(catalogOf(after)?.instructions).toContain("callRendererFunction");
    });

    it("sends the envelope only to the agents in agentIds", async () => {
      const { copilotkit, agent, other } = setup({
        ui,
        agentIds: ["default"],
      });

      const listed = await runOnce(copilotkit, agent);
      const unlisted = await runOnce(copilotkit, other);

      expect(catalogOf(listed)?.catalogId).toBe("shop");
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
      expect(catalogOf(CapturingAgent.inputs[0])?.catalogId).toBe("shop");

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
      expect(catalogOf(followUp)?.catalogId).toBe("shop");
    });
  });

  describe("debug source", () => {
    it("gives core a snapshot of the catalog, functions, and surfaces, and removes it on unmount", () => {
      const { copilotkit, runtime, setHandler, unmount } = setup();
      const source = copilotkit.ɵgenerativeUIDebugSource;
      expect(source).toBeDefined();

      setHandler(() => "applied");
      runtime.manager.ingest("t1", "default", buttonSurface("s1"));
      runtime.manager.setActiveThread("t1");
      const snapshot = source!.getSnapshot();
      expect(snapshot.catalogId).toBe("shop");
      expect(snapshot.transport).toBe("tool");
      expect(Object.keys(snapshot.components)).toEqual(["Box", "Button"]);
      expect(snapshot.functions.applyCoupon?.handlers).toBe(1);
      expect(snapshot.targets).toEqual([{ id: "chat", kind: "chat" }]);
      expect(snapshot.lastRun).toBeUndefined();
      expect(snapshot.surfaces).toHaveLength(1);
      expect(snapshot.surfaces[0]).toMatchObject({
        surfaceId: "s1",
        threadId: "t1",
        target: "chat",
        status: "ready",
        rejected: [],
      });
      expect(snapshot.surfaces[0]?.operations).toHaveLength(2);

      unmount();
      expect(copilotkit.ɵgenerativeUIDebugSource).toBeUndefined();
    });

    it("keeps the envelope of the last run and the render_ui guide that the runtime builds from it", async () => {
      const { copilotkit, agent } = setup();
      const listener = vi.fn();
      copilotkit.ɵgenerativeUIDebugSource!.subscribe(listener);

      const input = await runOnce(copilotkit, agent);

      const lastRun =
        copilotkit.ɵgenerativeUIDebugSource!.getSnapshot().lastRun;
      const sent = envelopeOf(input)!;
      expect(listener).toHaveBeenCalled();
      expect(lastRun?.agentId).toBe(agent.agentId);
      expect(lastRun?.envelope).toEqual(sent);
      expect(lastRun?.prompt).toEqual([
        {
          title: "render_ui guide",
          source: "runtime",
          text: buildGenerativeUIPrompt(envelopeToManifest(sent)),
        },
      ]);
    });

    it("shows the context entries that a markdown run sends", async () => {
      // The test setup gives every randomUUID call one id, so the second
      // context entry would replace the first.
      let count = 0;
      vi.mocked(randomUUID).mockImplementation(() => `id-${count++}`);
      onTestFinished(() => {
        vi.mocked(randomUUID).mockImplementation(() => "mock-thread-id");
      });
      const { copilotkit, agent } = setup({ ui, transport: "markdown" });

      const input = await runOnce(copilotkit, agent);

      const contextValue = (description: string) =>
        input.context.find((entry) => entry.description === description)?.value;
      const lastRun =
        copilotkit.ɵgenerativeUIDebugSource!.getSnapshot().lastRun;
      expect(
        lastRun?.prompt.map(({ source, text }) => ({ source, text })),
      ).toEqual([
        {
          source: "context",
          text: contextValue(GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION),
        },
        {
          source: "context",
          text: contextValue(GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION),
        },
      ]);
    });
  });

  describe("manifest functions", () => {
    it("does not advertise a built-in under a name the app declared, even while no handler is mounted", () => {
      const { runtime } = setup();
      const manifest = buildGenerativeUIManifest(runtime, undefined);
      // The test UI declares addToCart; formatNumber is a built-in.
      expect(manifest.functions).toHaveProperty("formatNumber");
      const shadowing = createGenerativeUI({
        id: "shadow",
        functions: {
          formatNumber: { parameters: z.object({ value: z.number() }) },
        },
        components: {},
      });
      const manager = new GenerativeUISurfaceManager(shadowing);
      const dispatcher = createGenerativeUIDispatcher({
        getDeclared: () => shadowing.functions,
      });
      const shadowed = buildGenerativeUIManifest(
        { ui: shadowing, manager, dispatcher },
        undefined,
      );
      expect(shadowed.functions).not.toHaveProperty("formatNumber");
      expect(shadowed.functions).toHaveProperty("formatCurrency");
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

    it("drops an event while the agent runs or another event is on its way, and takes the next one once idle", async () => {
      const { runtime, agent } = setup();
      act(() =>
        runtime.manager.ingest(agent.threadId, "default", buttonSurface("s1")),
      );
      const event = { name: "buy", ...origin, context: { sku: "a" } };

      // A double click: the second event arrives before the run has started.
      const first = runtime.forwardEvent(event, "default");
      const repeat = await runtime.forwardEvent(event, "default");
      expect(!repeat.ok && repeat.error.code).toBe("agent_busy");
      await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      agent.emit(runStartedEvent());

      // A click while the reply streams.
      const midRun = await runtime.forwardEvent(event, "default");
      expect(!midRun.ok && midRun.error.code).toBe("agent_busy");
      agent.emit(runFinishedEvent());
      await expect(first).resolves.toEqual({ ok: true, result: undefined });
      expect(CapturingAgent.inputs).toHaveLength(1);

      // Idle again: the next event is sent.
      const next = runtime.forwardEvent(event, "default");
      await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(2));
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());
      await expect(next).resolves.toEqual({ ok: true, result: undefined });
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
