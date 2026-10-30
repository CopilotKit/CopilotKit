import { Component, input, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { ComponentFixture } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { z } from "zod";
import { CopilotKit, provideCopilotKit } from "@copilotkit/angular";
import {
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
  GENERATIVE_UI_RENDER_TOOL,
  buildGenerativeUIMarkdownGuidelines,
  buildGenerativeUIPrompt,
  envelopeToManifest,
  isA2UIBasicFunction,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import {
  GenerativeUISurfaceManager,
  buildGenerativeUIManifest,
  createGenerativeUIDispatcher,
} from "@copilotkit/core/generative-ui";
import type {
  GenerativeUIInvokeResult,
  GenerativeUITheme,
} from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import { CopilotGenerativeUIChildren } from "../children.directive";
import type { GenerativeUIChildren } from "../children";
import { CopilotGenerativeUI } from "../generative-ui";
import { provideGenerativeUI } from "../provide";
import { CopilotGenerativeUISurface } from "../surface";
import {
  CapturingAgent,
  LICENSE_KEY,
  buttonSurface,
  catalogOf,
  envelopeOf,
  missingRootSurface,
  mountFunction,
  origin,
  runOnce,
  setup,
  ui,
} from "./generative-ui.helpers";

/** The guideline for this UI: no events, no multiple slot, and no function mounted. */
const SMALL_GUIDELINE = buildGenerativeUIMarkdownGuidelines({
  functions: false,
  events: false,
  templates: false,
  checks: false,
});

afterEach(() => vi.restoreAllMocks());

describe("CopilotGenerativeUI", () => {
  it("exposes a declared function only while a handler is mounted", async () => {
    const { root, setHandler } = setup();
    const invoke = () =>
      root.dispatcher.invoke("applyCoupon", { code: "SAVE" }, origin);
    expect(root.dispatcher.listExposed()).toEqual({});
    const before = await invoke();
    expect(!before.ok && before.error.code).toBe("function_not_found");

    setHandler(() => "applied");
    expect(Object.keys(root.dispatcher.listExposed())).toEqual(["applyCoupon"]);
    await expect(invoke()).resolves.toEqual({ ok: true, result: "applied" });

    setHandler(undefined);
    expect(root.dispatcher.listExposed()).toEqual({});
    const after = await invoke();
    expect(!after.ok && after.error.code).toBe("function_not_found");
  });

  it("hides the render_ui tool call", () => {
    const { copilotkit } = setup();
    expect(
      copilotkit
        .toolCallRenderConfigs()
        .some((config) => config.name === GENERATIVE_UI_RENDER_TOOL),
    ).toBe(true);
  });

  it("reportError never throws when the host onError throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn((_info: unknown) => {
      throw new Error("host boom");
    });
    const { root } = setup({ onError });

    expect(() =>
      root.reportError({
        kind: "render",
        surfaceId: "s1",
        error: new Error("render failed"),
      }),
    ).not.toThrow();

    // A rejected operation reports from inside ingestion, which must survive too.
    expect(() =>
      root.manager.ingest("t1", "default", missingRootSurface("s1")),
    ).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[1]![0]).toMatchObject({
      kind: "operation",
      surfaceId: "s1",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[generativeUI] onError threw:",
      expect.objectContaining({ message: "host boom" }),
    );
  });

  describe("envelope", () => {
    it("sends the tool envelope in the v1.0 capabilities shape, with the components and no instructions", async () => {
      const { core, agent } = setup();

      const envelope = envelopeOf(await runOnce(core, agent));

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
      const { core, agent, root, setHandler } = setup();
      setHandler(() => "applied");
      root.manager.ingest(agent.threadId, "default", missingRootSurface("s1"));

      const envelope = envelopeOf(await runOnce(core, agent));

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
      const { core, agent } = setup({ transport: "markdown" });

      const input = await runOnce(core, agent);

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
      const { core, agent } = setup({
        transport: "markdown",
        includeCatalog: false,
        sendContext: false,
      });

      const input = await runOnce(core, agent);

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
      const { core, agent, setHandler } = setup({ transport: "markdown" });

      const before = await runOnce(core, agent);
      setHandler(() => "ok");
      const after = await runOnce(core, agent);

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
      const { core, agent, other } = setup({ agentIds: ["default"] });

      const listed = await runOnce(core, agent);
      const unlisted = await runOnce(core, other);

      expect(catalogOf(listed)?.catalogId).toBe("shop");
      expect(unlisted.forwardedProps).not.toHaveProperty("copilotkit");
    });

    it("removes the envelope on unmount", async () => {
      const { core, agent, unmount } = setup();
      await runOnce(core, agent);
      expect(core.getPropertiesForAgent("default")).toHaveProperty(
        "copilotkit",
      );

      unmount();

      expect(core.getPropertiesForAgent("default")).toEqual({});
    });

    it("keeps the envelope on a tool follow-up run after the app sets new properties", async () => {
      CapturingAgent.inputs = [];
      const agent = new CapturingAgent("default");
      TestBed.configureTestingModule({
        providers: [
          provideCopilotKit({
            licenseKey: LICENSE_KEY,
            agents: { default: agent },
            properties: { userId: "a" },
            frontendTools: [
              {
                name: "switchUser",
                description: "Switches the user",
                parameters: z.object({}),
                followUp: true,
                // New properties before core starts the follow-up run.
                handler: async () => {
                  TestBed.inject(CopilotKit).updateRuntime({
                    properties: { userId: "b" },
                  });
                },
              },
            ],
          }),
          provideGenerativeUI({ ui }),
        ],
      });
      const { core } = TestBed.inject(CopilotKit);

      void core.runAgent({ agent });
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      expect(catalogOf(CapturingAgent.inputs[0]!)?.catalogId).toBe("shop");

      agent.start();
      agent.emit({
        type: EventType.TOOL_CALL_CHUNK,
        toolCallId: "tc1",
        toolCallName: "switchUser",
        parentMessageId: "m1",
        delta: "{}",
      } as BaseEvent);
      agent.finish();

      // Follow-up runs do not fire onAgentRunStarted. The envelope is a
      // scoped entry, so new properties do not replace it.
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(2));
      const followUp = CapturingAgent.inputs[1]!;
      expect(followUp.forwardedProps.userId).toBe("b");
      expect(catalogOf(followUp)?.catalogId).toBe("shop");
    });
  });

  describe("debug source", () => {
    it("gives core a snapshot of the catalog, functions, and surfaces, and removes it on unmount", () => {
      const { core, root, setHandler, unmount } = setup();
      const source = core.ɵgenerativeUIDebugSource;
      expect(source).toEqual({
        getSnapshot: expect.any(Function),
        subscribe: expect.any(Function),
      });

      setHandler(() => "applied");
      root.manager.ingest("t1", "default", buttonSurface("s1"));
      root.manager.setActiveThread("t1");
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
      expect(core.ɵgenerativeUIDebugSource).toBeUndefined();
    });

    it("keeps the envelope of the last run and the render_ui guide that the runtime builds from it", async () => {
      const { core, agent } = setup();
      const listener = vi.fn();
      core.ɵgenerativeUIDebugSource!.subscribe(listener);

      const input = await runOnce(core, agent);

      const lastRun = core.ɵgenerativeUIDebugSource!.getSnapshot().lastRun;
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
      const { core, agent } = setup({ transport: "markdown" });

      const input = await runOnce(core, agent);

      const contextValue = (description: string) =>
        input.context.find((entry) => entry.description === description)?.value;
      const lastRun = core.ɵgenerativeUIDebugSource!.getSnapshot().lastRun;
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
      const { root } = setup();
      const manifest = buildGenerativeUIManifest(root, undefined);
      // The test UI declares applyCoupon; formatNumber is a built-in.
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

    it("advertises the built-ins with their return type and as UI-only, and openUrl as a gesture function", () => {
      const { root } = setup();
      const { functions } = buildGenerativeUIManifest(root, undefined);
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
      expect(functions.series!.returnType).toBe("array");
    });
  });

  describe("function calls", () => {
    // Agent function calls are off for now (GENERATIVE_UI_AGENT_FUNCTION_CALLS):
    // the call is answered with an error. The answer and the follow-up run
    // work the same either way.
    it("answers an agent-called function with a developer message and starts one follow-up run", async () => {
      const { core, agent, setHandler } = setup();
      const handler = vi.fn((args: { code: string }) => `applied ${args.code}`);
      setHandler(handler);
      // The call is in the thread when the run starts, as after a reload or
      // when the agent sent it in an earlier run.
      agent.addMessage({
        id: "act-1",
        role: "activity",
        activityType: GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
        content: {
          functionCallId: "call-1",
          callFunction: { "@call": "applyCoupon", args: { code: "SAVE" } },
        },
      } as never);
      await runOnce(core, agent);
      // The answer and the follow-up run.
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(2));
      const followUp = CapturingAgent.inputs[1]!;
      const answer = followUp.messages.find((m) => m.role === "developer");
      expect(answer?.content).toContain('"functionCallId":"call-1"');
      if (GENERATIVE_UI_AGENT_FUNCTION_CALLS) {
        expect(handler).toHaveBeenCalledWith({ code: "SAVE" });
        expect(answer?.content).toContain("applied SAVE");
      } else {
        expect(handler).not.toHaveBeenCalled();
        expect(answer?.content).toContain('"error"');
      }
      agent.start();
      agent.finish();
    });
  });
});

type Handler = (args?: unknown) => Promise<GenerativeUIInvokeResult>;

const mounts = new Map<string, number>();

@Component({
  selector: "test-card",
  template: `
    <div [attr.data-testid]="'card-' + productId()">
      {{ name() }}
      <button (click)="onAddToCart()?.({ productId: productId() })">
        Add {{ productId() }}
      </button>
    </div>
  `,
})
class Card {
  readonly productId = input<string>();
  readonly name = input<string>();
  readonly onAddToCart = input<Handler>();
  constructor() {
    queueMicrotask(() => {
      const id = this.productId() ?? "";
      mounts.set(id, (mounts.get(id) ?? 0) + 1);
    });
  }
}

@Component({
  selector: "test-grid",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <div><ng-container *copilotGenerativeUIChildren="children()" /></div>
  `,
})
class Grid {
  readonly children = input<GenerativeUIChildren>();
}

const shopUI = createGenerativeUI({
  id: "shop",
  functions: {
    addToCart: { parameters: z.object({ productId: z.string() }) },
    applyCoupon: { parameters: z.object({}) },
  },
  components: {
    Grid: { component: Grid, slots: { children: "multiple" } },
    // `onAddToCart` calls the `addToCart` function.
    Card: {
      component: Card,
      props: z.object({ productId: z.string(), name: z.string() }),
      events: { onAddToCart: {} },
    },
  },
});

@Component({
  imports: [CopilotGenerativeUISurface],
  template: `
    <section data-testid="inline">
      <copilot-generative-ui-surface
        id="recommendations"
        description="Next to the product list. Use it for recommendations."
        [components]="['Grid', 'Card']"
      >
        <span>No recommendations yet</span>
      </copilot-generative-ui-surface>
    </section>
  `,
})
class InlineHost {}

const create = (surfaceId: string) => ({
  version: "v1.0",
  createSurface: { surfaceId, catalogId: "shop" },
});
const nodes = (surfaceId: string, ...components: unknown[]) => ({
  version: "v1.0",
  updateComponents: { surfaceId, components },
});
const snapshot = (
  surfaceId: string,
  target: string,
  operations: unknown[],
): BaseEvent =>
  ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: `genui:${surfaceId}`,
    activityType: "generative-ui-surface",
    content: {
      surfaceId,
      target,
      catalogId: "shop",
      operations,
      status: "streaming",
      rejected: [],
    },
    replace: true,
  }) as BaseEvent;
const append = (surfaceId: string, op: unknown): BaseEvent =>
  ({
    type: EventType.ACTIVITY_DELTA,
    messageId: `genui:${surfaceId}`,
    activityType: "generative-ui-surface",
    patch: [{ op: "add", path: "/operations/-", value: op }],
  }) as BaseEvent;
const card = (id: string) => ({
  id,
  component: "Card",
  productId: id,
  name: `Product ${id}`,
});

/** The manifest that a run sent, read the way the runtime reads it. */
function manifestOf(input: RunAgentInput | undefined) {
  const envelope = readCopilotKitUIEnvelope(input?.forwardedProps);
  return envelope && envelopeToManifest(envelope);
}

describe("generative UI integration", () => {
  function setupInline(theme?: GenerativeUITheme | ReturnType<typeof signal>) {
    CapturingAgent.inputs = [];
    mounts.clear();
    const agent = new CapturingAgent("default");
    const addToCart = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          licenseKey: LICENSE_KEY,
          agents: { default: agent },
        }),
        provideGenerativeUI({
          ui: shopUI,
          theme: theme as GenerativeUITheme | undefined,
        }),
      ],
    });
    const { core } = TestBed.inject(CopilotKit);
    mountFunction(shopUI, "addToCart", addToCart);
    mountFunction(shopUI, "applyCoupon", async () => "ok");
    const fixture: ComponentFixture<InlineHost> =
      TestBed.createComponent(InlineHost);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const inline = () => element.querySelector("[data-testid=inline]")!;
    /** Runs the agent once, with `emit` between the run start and its end. */
    const run = async (emit: () => void = () => {}) => {
      const index = CapturingAgent.inputs.length;
      const pending = core.runAgent({ agent });
      await vi.waitFor(() =>
        expect(CapturingAgent.inputs.length).toBeGreaterThan(index),
      );
      agent.start();
      emit();
      agent.finish();
      await pending;
      fixture.detectChanges();
      fixture.detectChanges();
      return CapturingAgent.inputs[index]!;
    };
    return { agent, core, addToCart, fixture, element, inline, run };
  }

  it("sends an envelope with mounted targets, their descriptions and components, and the functions with a handler", async () => {
    const { run } = setupInline();
    const manifest = manifestOf(await run());
    expect(manifest?.catalogId).toBe("shop");
    expect(manifest?.targets).toEqual([
      { id: "chat", kind: "chat" },
      {
        id: "recommendations",
        kind: "inline",
        description: "Next to the product list. Use it for recommendations.",
        components: ["Grid", "Card"],
      },
    ]);
    // The app functions, next to the built-in ones of the catalog.
    const appFunctions = Object.keys(manifest?.functions ?? {}).filter(
      (name) => !isA2UIBasicFunction(name),
    );
    expect(appFunctions.sort()).toEqual(["addToCart", "applyCoupon"]);
    expect(manifest?.functions).toHaveProperty("formatCurrency");
    expect(Object.keys(manifest?.components ?? {})).toEqual(["Grid", "Card"]);
  });

  it("renders inline-targeted surfaces only in their mount and binds clicks to host functions", async () => {
    const { agent, addToCart, fixture, element, inline, run } = setupInline();
    expect(element.textContent).toContain("No recommendations yet");
    await run(() => {
      agent.emit(snapshot("recs", "recommendations", [create("recs")]));
      agent.emit(
        append(
          "recs",
          nodes("recs", { id: "root", component: "Grid", children: ["p1"] }),
        ),
      );
      agent.emit(append("recs", nodes("recs", card("p1"))));
    });

    expect(inline().textContent).toContain("Product p1");
    expect(element.textContent?.match(/Product p1/g)).toHaveLength(1);

    const runsBefore = CapturingAgent.inputs.length;
    const button = [...inline().querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add p1"),
    )!;
    button.click();
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(addToCart).toHaveBeenCalledExactlyOnceWith({ productId: "p1" }),
    );
    expect(CapturingAgent.inputs.length).toBe(runsBefore);
  });

  it("second run updates the inline surface in place", async () => {
    const { agent, element, run } = setupInline();
    await run(() => {
      agent.emit(
        snapshot("recs", "recommendations", [
          create("recs"),
          nodes("recs", {
            id: "root",
            component: "Grid",
            children: ["p1", "p2"],
          }),
          nodes("recs", card("p1")),
        ]),
      );
    });
    expect(element.textContent).toContain("Product p1");

    const second = await run(() => {
      agent.emit(append("recs", nodes("recs", card("p2"))));
    });
    expect(manifestOf(second)?.surfaces).toEqual({
      recs: { target: "recommendations" },
    });
    expect(element.textContent).toContain("Product p2");
    await vi.waitFor(() => expect(mounts.get("p1")).toBe(1));
  });

  it("sets the theme variables in a stylesheet of the surface root and updates them without a remount", async () => {
    const theme = signal<GenerativeUITheme | undefined>({
      "--a2ui-color-accent": "#111111",
      mapStyle: "https://tiles.example/style.json",
    });
    const { agent, element, fixture, run } = setupInline(theme);
    await run(() => {
      agent.emit(
        snapshot("recs", "recommendations", [
          create("recs"),
          nodes("recs", card("root")),
        ]),
      );
    });
    expect(element.textContent).toContain("Product root");
    const surfaceRoot = () =>
      element.querySelector<HTMLElement>('[data-generative-ui-root="recs"]')!;
    const id = () => surfaceRoot().getAttribute("data-a2ui-theme");
    const css = () =>
      document.getElementById(`a2ui-theme-${id()}`)?.textContent ?? "";
    expect(css()).toBe(
      `.a2ui-surface[data-a2ui-theme="${id()}"]{--a2ui-color-accent:#111111}`,
    );
    expect(css()).not.toContain("tiles.example");
    const firstId = id();
    const sheets = () =>
      document.head.querySelectorAll('style[id^="a2ui-theme-"]').length;
    const sheetsBefore = sheets();

    theme.set({
      "--a2ui-color-accent": "#222222",
      dark: { "--a2ui-color-accent": "#eeeeee" },
    });
    fixture.detectChanges();
    fixture.detectChanges();

    const self = `.a2ui-surface[data-a2ui-theme="${id()}"]`;
    expect(css()).toBe(
      `${self}{--a2ui-color-accent:#222222}:where(.dark) ${self},${self}:where(.dark){--a2ui-color-accent:#eeeeee}`,
    );
    // The sheet of the previous theme is gone, so theme changes do not pile up.
    expect(document.getElementById(`a2ui-theme-${firstId}`)).toBeNull();
    expect(sheets()).toBe(sheetsBefore);
    await vi.waitFor(() => expect(mounts.get("root")).toBe(1));
    const lastId = id();
    fixture.destroy();
    expect(document.getElementById(`a2ui-theme-${lastId}`)).toBeNull();
  });
});
