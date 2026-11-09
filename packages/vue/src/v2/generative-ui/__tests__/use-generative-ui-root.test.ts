import { render, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineComponent,
  nextTick,
  provide,
  ref,
  shallowRef,
  watch,
} from "vue";
import type { PropType } from "vue";
import { z } from "zod";
import {
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
  buildGenerativeUIMarkdownGuidelines,
  buildGenerativeUIPrompt,
  envelopeToManifest,
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import type { RunAgentInput } from "@ag-ui/client";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import {
  buildGenerativeUIManifest,
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import type {
  AnyGenerativeUI,
  GenerativeUIErrorInfo,
} from "@copilotkit/shared/generative-ui";
import { CopilotKitCoreVue } from "../../lib/vue-core";
import {
  runFinishedEvent,
  runStartedEvent,
  toolCallChunkEvent,
} from "../../__tests__/utils/test-helpers";
import { createGenerativeUI } from "../catalog";
import { useGenerativeUIFunction } from "../hooks";
import { useGenerativeUIRoot } from "../use-generative-ui-root";
import { GenerativeUIRuntimeKey } from "../runtime-context";
import type {
  GenerativeUIConfig,
  GenerativeUIRuntime,
} from "../runtime-context";
import { CapturingAgent, runOnce } from "./helpers/capturing-agent";

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
  components: ["Box", "Button"],
  functions: false,
  events: false,
  templates: false,
  checks: false,
});

type CouponHandler = (args: { code: string }) => unknown;

const Coupon = defineComponent({
  props: {
    handler: { type: Function as PropType<CouponHandler>, required: true },
  },
  setup(props) {
    // The handler reads the prop when it runs, so it is always the latest.
    useGenerativeUIFunction(ui, "applyCoupon", (args) => props.handler(args));
    return () => null;
  },
});

/** Runs the root in its setup and provides the runtime, as the provider will. */
function createRoot(
  copilotkit: CopilotKitCoreVue,
  config: () => GenerativeUIConfig | undefined,
  onRuntime: (runtime: ReturnType<typeof useGenerativeUIRoot>) => void,
) {
  return defineComponent({
    setup() {
      const runtime = useGenerativeUIRoot(copilotkit, config);
      provide(GenerativeUIRuntimeKey, runtime);
      onRuntime(runtime);
      return {};
    },
    template: "<slot />",
  });
}

function setup(initialConfig: GenerativeUIConfig | undefined = { ui }) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent();
  const other = new CapturingAgent();
  const copilotkit = new CopilotKitCoreVue({
    agents__unsafe_dev_only: { default: agent, other },
  });
  const config = shallowRef(initialConfig);
  let runtimeRef!: ReturnType<typeof useGenerativeUIRoot>;
  const Root = createRoot(
    copilotkit,
    () => config.value,
    (runtime) => {
      runtimeRef = runtime;
    },
  );
  const Host = defineComponent({
    components: { Root, Coupon },
    props: { handler: Function as PropType<CouponHandler> },
    template: `<Root><Coupon v-if="handler" :handler="handler" /></Root>`,
  });
  const { rerender, unmount } = render(Host);
  return {
    agent,
    other,
    copilotkit,
    runtime: runtimeRef.value!,
    runtimeRef,
    setHandler: (handler?: CouponHandler) => rerender({ handler }),
    setConfig: async (next: GenerativeUIConfig | undefined) => {
      config.value = next;
      await nextTick();
    },
    unmount,
  };
}

/** The envelope of a run, read the way the runtime reads it. */
function envelopeOf(input: RunAgentInput) {
  return readCopilotKitUIEnvelope(input.forwardedProps);
}

/** The one inline catalog of the envelope of a run. */
function catalogOf(input: RunAgentInput) {
  return envelopeOf(input)?.["1.0"].inlineCatalogs?.[0];
}

/** The manifest that the engine builds for a runtime. */
function manifestOf(runtime: GenerativeUIRuntime) {
  // The engine's `ui` type takes function and class components only.
  const engineUI: AnyGenerativeUI = runtime.ui;
  return buildGenerativeUIManifest(
    { ui: engineUI, manager: runtime.manager, dispatcher: runtime.dispatcher },
    undefined,
  );
}

function buttonSurface(surfaceId: string): GenerativeUISurfaceContent {
  return {
    surfaceId,
    target: "chat",
    catalogId: "shop",
    status: "ready",
    rejected: [],
    operations: [
      { version: "1.0", createSurface: { surfaceId, catalogId: "shop" } },
      {
        version: "1.0",
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
      { version: "1.0", createSurface: { surfaceId, catalogId: "shop" } },
      {
        version: "1.0",
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

    await setHandler(() => "applied");
    expect(Object.keys(runtime.dispatcher.listExposed())).toEqual([
      "applyCoupon",
    ]);
    await expect(invoke()).resolves.toEqual({ ok: true, result: "applied" });

    await setHandler(undefined);
    expect(runtime.dispatcher.listExposed()).toEqual({});
    const after = await invoke();
    expect(!after.ok && after.error.code).toBe("function_not_found");
  });

  it("runs the latest handler closure and keeps one registration across re-renders and StrictMode remounts", async () => {
    const { runtime, setHandler } = setup();
    const first = vi.fn(() => "first");
    const latest = vi.fn(() => "latest");
    // Vue has no StrictMode: mount, unmount, and mount again, then re-render.
    await setHandler(first);
    await setHandler(undefined);
    await setHandler(first);
    await setHandler(latest);

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
    const onError = vi.fn<(info: GenerativeUIErrorInfo) => void>(() => {
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
    it("sends the tool envelope in the 1.0 capabilities shape, with the components and no instructions", async () => {
      const { copilotkit, agent } = setup();

      const envelope = envelopeOf(await runOnce(copilotkit, agent));

      expect(envelope).toStrictEqual({
        "1.0": {
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
      await setHandler(() => "applied");
      runtime.manager.ingest(
        agent.threadId,
        "default",
        missingRootSurface("s1"),
      );

      const envelope = envelopeOf(await runOnce(copilotkit, agent));

      expect(envelope && envelopeToManifest(envelope)).toEqual({
        catalogId: "shop",
        catalogIds: ["shop"],
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
            allowedCallers: "rendererOnly",
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
      await setHandler(() => "ok");
      const after = await runOnce(copilotkit, agent);

      expect(catalogOf(before)?.instructions).not.toContain(
        "callRendererFunction",
      );
      // While the agent path is off, mounting a function adds no rule.
      if (GENERATIVE_UI_AGENT_FUNCTION_CALLS) {
        expect(catalogOf(after)?.instructions).toContain(
          "callRendererFunction",
        );
      } else {
        expect(catalogOf(after)?.instructions).not.toContain(
          "callRendererFunction",
        );
      }
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
      const copilotkit = new CopilotKitCoreVue({
        agents__unsafe_dev_only: { default: agent },
      });
      const userId = ref("a");
      // The provider sets its `properties` prop on core when it changes.
      watch(userId, (id) => copilotkit.setProperties({ userId: id }), {
        immediate: true,
      });
      copilotkit.addTool({
        name: "switchUser",
        parameters: z.object({}),
        followUp: true,
        // Flush the host update before core starts the follow-up run.
        handler: async () => {
          userId.value = "b";
          await nextTick();
        },
      });
      // A new config object on every read, as an inline prop object gives.
      const Root = createRoot(
        copilotkit,
        () => ({ ui }),
        () => {},
      );
      render(Root);

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
    it("gives core a snapshot of the catalog, functions, and surfaces, and removes it on unmount", async () => {
      const { copilotkit, runtime, setHandler, unmount } = setup();
      const source = copilotkit.ɵgenerativeUIDebugSource;
      expect(source).toBeDefined();

      await setHandler(() => "applied");
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
      const manifest = manifestOf(runtime);
      // The test UI declares addToCart; formatNumber is a built-in.
      expect(manifest.functions).toHaveProperty("formatNumber");
      const shadowing: AnyGenerativeUI = createGenerativeUI({
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

    it("advertises the built-ins with their return type and as UI-only, and openUrl as a gesture function", () => {
      const { runtime } = setup();
      const { functions } = manifestOf(runtime);
      expect(functions.formatNumber).toMatchObject({
        returnType: "string",
        allowedCallers: "rendererOnly",
      });
      expect(functions.formatNumber).not.toHaveProperty(
        "requiresUserActivation",
      );
      expect(functions.openUrl).toMatchObject({
        returnType: "void",
        allowedCallers: "rendererOnly",
        requiresUserActivation: true,
      });
      expect(functions.series.returnType).toBe("array");
    });
  });

  describe("forwardEvent", () => {
    it("adds the event as a user message with the label of its component, then runs the agent", async () => {
      const { runtime, agent } = setup();
      runtime.manager.ingest(agent.threadId, "default", buttonSurface("s1"));

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

    it("sends the A2UI action message of the event in the envelope of its run, and not in the next run", async () => {
      const { runtime, agent, copilotkit } = setup();
      runtime.manager.ingest(agent.threadId, "default", buttonSurface("s1"));

      const pending = runtime.forwardEvent(
        {
          name: "buy",
          ...origin,
          timestamp: "2026-10-20T10:00:00.000Z",
          userMessage: "Buy it",
          context: { sku: "a" },
        },
        "default",
      );
      await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      const sent = envelopeOf(CapturingAgent.inputs[0]);
      expect(sent?.metadata.extensions.copilotkit_action).toEqual({
        version: "1.0",
        action: {
          name: "buy",
          surfaceId: "s1",
          sourceComponentId: origin.componentId,
          timestamp: "2026-10-20T10:00:00.000Z",
          userMessage: "Buy it",
          context: { sku: "a" },
        },
      });
      agent.emit(runStartedEvent());
      // Another agent that runs in the meantime gets the envelope, but not
      // a click meant for this one.
      const elsewhere = readCopilotKitUIEnvelope(
        copilotkit.getPropertiesForAgent("other"),
      );
      expect(elsewhere?.["1.0"].supportedCatalogIds).toEqual(["shop"]);
      expect(elsewhere?.metadata.extensions).not.toHaveProperty(
        "copilotkit_action",
      );
      agent.emit(runFinishedEvent());
      await expect(pending).resolves.toEqual({ ok: true, result: undefined });

      // Once the run is over, a request that reads the properties with no
      // run start (a suggestion request, a follow-up) gets no action.
      await waitFor(() =>
        expect(
          readCopilotKitUIEnvelope(copilotkit.getPropertiesForAgent("default"))
            ?.metadata.extensions,
        ).not.toHaveProperty("copilotkit_action"),
      );

      // A run that the user starts carries no action.
      const plain = envelopeOf(await runOnce(copilotkit, agent));
      expect(plain?.metadata.extensions).not.toHaveProperty(
        "copilotkit_action",
      );
    });

    it("sends the action of an event for another agent while this one runs", async () => {
      const { runtime, agent, other, copilotkit } = setup();
      // The first agent runs; its run start set the shared envelope.
      const first = copilotkit.runAgent({ agent });
      await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      agent.emit(runStartedEvent());

      // A click for the other agent: its run gets no run-start notification
      // while the first one runs, and still carries its action.
      const pending = runtime.forwardEvent(
        { name: "pick", ...origin, context: { plan: "team" } },
        "other",
      );
      await waitFor(() => expect(CapturingAgent.inputs).toHaveLength(2));
      const action = envelopeOf(CapturingAgent.inputs[1])?.metadata.extensions
        .copilotkit_action;
      expect(action?.action).toMatchObject({
        name: "pick",
        context: { plan: "team" },
      });
      // The first agent did not get it.
      expect(
        readCopilotKitUIEnvelope(copilotkit.getPropertiesForAgent("default"))
          ?.metadata.extensions,
      ).not.toHaveProperty("copilotkit_action");

      other.emit(runStartedEvent());
      other.emit(runFinishedEvent());
      // The action goes when the run ends, before any follow-up run; the
      // agent was not watched before, so the agent itself says so.
      await waitFor(() =>
        expect(
          readCopilotKitUIEnvelope(copilotkit.getPropertiesForAgent("other"))
            ?.metadata.extensions,
        ).not.toHaveProperty("copilotkit_action"),
      );
      await expect(pending).resolves.toEqual({ ok: true, result: undefined });
      agent.emit(runFinishedEvent());
      await first;
    });

    it("drops an event while the agent runs or another event is on its way, and takes the next one once idle", async () => {
      const { runtime, agent } = setup();
      runtime.manager.ingest(agent.threadId, "default", buttonSurface("s1"));
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

describe("useGenerativeUIRoot (Vue-specific semantics)", () => {
  it("gives a new runtime object when the theme or the transport changes, with the same manager", async () => {
    const { runtime, runtimeRef, setConfig } = setup({
      ui,
      theme: { "--a2ui-color-accent": "red" },
    });

    // A shallow-equal theme keeps the runtime.
    await setConfig({ ui, theme: { "--a2ui-color-accent": "red" } });
    expect(runtimeRef.value).toBe(runtime);

    await setConfig({ ui, theme: { "--a2ui-color-accent": "blue" } });
    expect(runtimeRef.value).not.toBe(runtime);
    expect(runtimeRef.value?.theme).toEqual({ "--a2ui-color-accent": "blue" });
    expect(runtimeRef.value?.manager).toBe(runtime.manager);

    await setConfig({
      ui,
      transport: "markdown",
      theme: { "--a2ui-color-accent": "blue" },
    });
    expect(runtimeRef.value?.transport).toBe("markdown");
    expect(runtimeRef.value?.manager).toBe(runtime.manager);
  });

  it("removes the envelope and the debug source when the config is removed, and gives null", async () => {
    const { copilotkit, agent, runtimeRef, setConfig } = setup();
    await runOnce(copilotkit, agent);

    await setConfig(undefined);

    expect(runtimeRef.value).toBeNull();
    expect(copilotkit.getPropertiesForAgent("default")).toEqual({});
    expect(copilotkit.ɵgenerativeUIDebugSource).toBeUndefined();
  });

  it("builds a new manager for a new ui and wires the new one", async () => {
    const { copilotkit, agent, runtime, runtimeRef, setConfig } = setup();
    const nextUI = createGenerativeUI({
      id: "next",
      components: { Box: { component: () => null } },
    });

    await setConfig({ ui: nextUI });
    const input = await runOnce(copilotkit, agent);

    expect(runtimeRef.value?.manager).not.toBe(runtime.manager);
    expect(catalogOf(input)?.catalogId).toBe("next");
    expect(copilotkit.ɵgenerativeUIDebugSource?.getSnapshot().catalogId).toBe(
      "next",
    );
  });
});
