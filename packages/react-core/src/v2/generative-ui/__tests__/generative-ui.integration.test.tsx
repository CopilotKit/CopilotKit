import React, { useEffect } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  envelopeToManifest,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../../components/chat/CopilotChat";
import {
  MockStepwiseAgent,
  runFinishedEvent,
  runStartedEvent,
} from "../../__tests__/utils/test-helpers";
import {
  createGenerativeUI,
  GenerativeUISurface,
  useGenerativeUIFunction,
} from "..";
import type {
  GenerativeUIChatSurfaceProps,
  GenerativeUIEventHandler,
  GenerativeUITheme,
} from "..";

class CapturingAgent extends MockStepwiseAgent {
  static inputs: RunAgentInput[] = [];
  run(input: RunAgentInput) {
    CapturingAgent.inputs.push(input);
    return super.run(input);
  }
}

const mounts = new Map<string, number>();
function Card({
  productId,
  name,
  onAddToCart,
}: {
  productId: string;
  name: string;
  onAddToCart?: GenerativeUIEventHandler<typeof ui, "onAddToCart">;
}) {
  useEffect(() => {
    mounts.set(productId, (mounts.get(productId) ?? 0) + 1);
  }, []);
  return (
    <div data-testid={`card-${productId}`}>
      {name}
      <button onClick={() => onAddToCart?.({ productId })}>
        Add {productId}
      </button>
    </div>
  );
}
function Grid({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}
const ui = createGenerativeUI({
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

const T = "thread-1";
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
const patch = (surfaceId: string, ...ops: unknown[]): BaseEvent =>
  ({
    type: EventType.ACTIVITY_DELTA,
    messageId: `genui:${surfaceId}`,
    activityType: "generative-ui-surface",
    patch: ops,
  }) as BaseEvent;
const card = (id: string) => ({
  id,
  component: "Card",
  productId: id,
  name: `Product ${id}`,
});

const cardEl = () =>
  document.querySelector(
    '[data-generative-ui-chat-surface="cmp"]',
  ) as HTMLElement | null;

const surfaceRoot = (surfaceId: string) =>
  document.querySelector<HTMLElement>(
    `[data-generative-ui-root="${surfaceId}"]`,
  )!;

function Handlers({ addToCart }: { addToCart: () => void }) {
  useGenerativeUIFunction(ui, "addToCart", addToCart);
  useGenerativeUIFunction(ui, "applyCoupon", async () => "ok");
  return null;
}

function setup(theme?: GenerativeUITheme) {
  CapturingAgent.inputs = [];
  mounts.clear();
  const agent = new CapturingAgent();
  const addToCart = vi.fn();
  const tree = (nextTheme?: GenerativeUITheme) => (
    <CopilotKitProvider
      agents__unsafe_dev_only={{ default: agent }}
      generativeUI={{ ui, theme: nextTheme }}
    >
      <CopilotChatConfigurationProvider agentId="default" threadId={T}>
        <Handlers addToCart={addToCart} />
        <section data-testid="inline">
          <GenerativeUISurface<typeof ui>
            id="recommendations"
            description="Next to the product list. Use it for recommendations."
            components={["Grid", "Card"]}
            fallback={<span>No recommendations yet</span>}
          />
        </section>
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
  const { rerender } = render(tree(theme));
  return {
    agent,
    addToCart,
    setTheme: (next: GenerativeUITheme) => rerender(tree(next)),
  };
}

/** The manifest that a run sent, read the way the runtime reads it. */
function manifestOf(input: RunAgentInput | undefined) {
  const envelope = readCopilotKitUIEnvelope(input?.forwardedProps);
  return envelope && envelopeToManifest(envelope);
}

async function send(text: string) {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
}

describe("generative UI integration", () => {
  it("sends an envelope with mounted targets, their descriptions and components, and the functions with a handler", async () => {
    const { agent } = setup();
    await send("hi");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    const manifest = manifestOf(CapturingAgent.inputs[0]);
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
    expect(Object.keys(manifest?.functions ?? {}).sort()).toEqual([
      "addToCart",
      "applyCoupon",
    ]);
    expect(Object.keys(manifest?.components ?? {})).toEqual(["Grid", "Card"]);
  });

  it("renders inline-targeted surfaces only in their mount and binds clicks to host functions", async () => {
    const { agent, addToCart } = setup();
    expect(screen.getByText("No recommendations yet")).toBeTruthy();
    await send("recommend");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(snapshot("recs", "recommendations", [create("recs")]));
    agent.emit(
      append(
        "recs",
        nodes("recs", { id: "root", component: "Grid", children: ["p1"] }),
      ),
    );
    agent.emit(append("recs", nodes("recs", card("p1"))));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));

    const inline = screen.getByTestId("inline");
    await waitFor(() =>
      expect(within(inline).getByText("Product p1")).toBeTruthy(),
    );
    expect(screen.getAllByText("Product p1")).toHaveLength(1);

    const runsBefore = CapturingAgent.inputs.length;
    await act(async () => fireEvent.click(within(inline).getByText("Add p1")));
    expect(addToCart).toHaveBeenCalledExactlyOnceWith({ productId: "p1" });
    expect(CapturingAgent.inputs.length).toBe(runsBefore);
  });

  it("renders chat-targeted surfaces in the transcript with the default card", async () => {
    const { agent } = setup();
    await send("compare");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(
      snapshot("cmp", "chat", [create("cmp"), nodes("cmp", card("root"))]),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() => {
      const chatCard = document.querySelector(
        '[data-generative-ui-chat-surface="cmp"]',
      );
      expect(chatCard?.textContent).toContain("Product root");
    });
    expect(
      within(screen.getByTestId("inline")).queryByText("Product root"),
    ).toBeNull();
  });

  it("shows a friendly chat-card error only while the latest call has rejections", async () => {
    const { agent } = setup();
    await send("compare");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    // Turn 1: the server rejected op 2, and op 1 fails client-side (unknown component).
    agent.emit(
      snapshot("cmp", "chat", [
        create("cmp"),
        nodes("cmp", { id: "x", component: "Nope" }),
      ]),
    );
    agent.emit(
      patch(
        "cmp",
        {
          op: "add",
          path: "/rejected/-",
          value: {
            index: 2,
            reason: 'component "p3": unknown prop "category"',
          },
        },
        { op: "replace", path: "/status", value: "ready" },
      ),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() =>
      expect(within(cardEl()!).getByRole("alert").textContent).toBe(
        "Part of this UI couldn't be shown.",
      ),
    );
    expect(cardEl()!.textContent).not.toContain("category");

    // Turn 2: the model repairs the card; the runtime resets status and rejected.
    await send("fix it");
    agent.emit(runStartedEvent({ threadId: T, runId: "r2" }));
    agent.emit(
      patch(
        "cmp",
        { op: "replace", path: "/status", value: "streaming" },
        { op: "replace", path: "/rejected", value: [] },
        { op: "add", path: "/operations/-", value: nodes("cmp", card("root")) },
      ),
    );
    agent.emit(
      patch("cmp", { op: "replace", path: "/status", value: "ready" }),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r2" }));
    await waitFor(() =>
      expect(cardEl()!.textContent).toContain("Product root"),
    );
    expect(within(cardEl()!).queryByRole("alert")).toBeNull();
  });

  it("passes the raw rejection list to a custom chat wrapper", async () => {
    CapturingAgent.inputs = [];
    const agent = new CapturingAgent();
    const seen: unknown[] = [];
    function Wrapper({
      error,
      rejected,
      children,
    }: GenerativeUIChatSurfaceProps) {
      seen.push({ cause: error?.cause, rejected });
      return <div data-testid="custom-wrapper">{children}</div>;
    }
    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agent }}
        generativeUI={{ ui }}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId={T}>
          <div style={{ height: 400 }}>
            <CopilotChat welcomeScreen={false} generativeUISurface={Wrapper} />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    await send("compare");
    const reason = 'component "p3": unknown prop "category"';
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(snapshot("cmp", "chat", [create("cmp")]));
    agent.emit(
      patch("cmp", {
        op: "add",
        path: "/rejected/-",
        value: { index: 1, reason },
      }),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    const expected = [{ index: 1, reason }];
    await waitFor(() =>
      expect(seen.at(-1)).toEqual({ cause: expected, rejected: expected }),
    );
  });

  it("second run updates the inline surface in place", async () => {
    const { agent } = setup();
    await send("recommend");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
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
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() => expect(screen.getByText("Product p1")).toBeTruthy());

    await send("one more");
    expect(manifestOf(CapturingAgent.inputs.at(-1))?.surfaces).toEqual({
      recs: { target: "recommendations" },
    });
    agent.emit(runStartedEvent({ threadId: T, runId: "r2" }));
    agent.emit(append("recs", nodes("recs", card("p2"))));
    agent.emit(runFinishedEvent({ threadId: T, runId: "r2" }));
    await waitFor(() => expect(screen.getByText("Product p2")).toBeTruthy());
    expect(mounts.get("p1")).toBe(1);
  });

  it("sets the theme variables on the surface root and updates them without a remount", async () => {
    const { agent, setTheme } = setup({
      "--a2ui-color-primary": "#111111",
      mapStyle: "https://tiles.example/style.json",
    });
    await send("recommend");
    agent.emit(runStartedEvent({ threadId: T, runId: "r1" }));
    agent.emit(
      snapshot("recs", "recommendations", [
        create("recs"),
        nodes("recs", card("root")),
      ]),
    );
    agent.emit(runFinishedEvent({ threadId: T, runId: "r1" }));
    await waitFor(() => expect(screen.getByText("Product root")).toBeTruthy());
    expect(
      surfaceRoot("recs").style.getPropertyValue("--a2ui-color-primary"),
    ).toBe("#111111");
    expect(surfaceRoot("recs").getAttribute("style")).not.toContain(
      "tiles.example",
    );

    setTheme({ "--a2ui-color-primary": "#222222" });

    expect(
      surfaceRoot("recs").style.getPropertyValue("--a2ui-color-primary"),
    ).toBe("#222222");
    expect(mounts.get("root")).toBe(1);
  });
});
