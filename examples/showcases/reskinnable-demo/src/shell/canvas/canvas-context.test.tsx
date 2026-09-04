import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasProvider,
  classifyA2uiSurface,
  useCanvas,
} from "./canvas-context";

// The provider derives its surface from `agent.messages`; serve a mutable ref
// so each test can install its own stream before rendering.
const { messagesRef } = vi.hoisted(() => ({
  messagesRef: { current: [] as unknown[] },
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: { messages: messagesRef.current } }),
}));

const opsFor = (surfaceId: string) => ({
  a2ui_operations: [{ createSurface: { surfaceId } }],
});

const a2uiSurface = (surfaceId: string, id: string) => ({
  id,
  role: "activity",
  activityType: "a2ui-surface",
  content: opsFor(surfaceId),
});

/** An `a2ui-surface` activity the stream never gave an id to. */
const idlessSurface = (surfaceId: string) => ({
  role: "activity",
  activityType: "a2ui-surface",
  content: opsFor(surfaceId),
});

/** An `a2ui-surface` activity carrying arbitrary (possibly junk) content. */
const surfaceWithContent = (content: unknown, id?: string) => ({
  ...(id ? { id } : {}),
  role: "activity",
  activityType: "a2ui-surface",
  content,
});

function Probe() {
  const { activeSurfaceKind, activeSurfaceId, clear } = useCanvas();
  return (
    <div>
      <span data-testid="kind">{activeSurfaceKind ?? "none"}</span>
      <span data-testid="id">{activeSurfaceId ?? "none"}</span>
      <button type="button" onClick={clear}>
        dismiss
      </button>
    </div>
  );
}

// A FUNCTION, not a constant element: React bails out of re-rendering when it
// is handed the very same element object, which would make `rerender` a no-op.
const tree = () => (
  <CanvasProvider>
    <Probe />
  </CanvasProvider>
);

const read = () => ({
  kind: screen.getByTestId("kind").textContent,
  id: screen.getByTestId("id").textContent,
});

function mount(messages: unknown[]) {
  messagesRef.current = messages;
  const view = render(tree());
  return {
    read,
    /** Click "← Back". */
    dismiss: () => fireEvent.click(screen.getByRole("button")),
    rerender: () => view.rerender(tree()),
    /** Append a message to the stream the way a live run would, then re-render. */
    push: (message: unknown) => {
      messagesRef.current = [...(messagesRef.current as unknown[]), message];
      view.rerender(tree());
    },
  };
}

function renderWith(messages: unknown[]) {
  messagesRef.current = messages;
  render(tree());
  return read();
}

afterEach(() => {
  cleanup();
  messagesRef.current = [];
  vi.restoreAllMocks();
});

describe("useLatestCanvasSurface (via CanvasProvider)", () => {
  it("claims a report surface for the canvas", () => {
    expect(renderWith([a2uiSurface("keel-ops-report-x1", "m1")])).toEqual({
      kind: "report",
      id: "m1",
    });
  });

  it("claims an OGUI surface for the canvas", () => {
    expect(
      renderWith([
        { id: "m1", role: "activity", activityType: "open-generative-ui" },
      ]),
    ).toEqual({ kind: "ogui", id: "m1" });
  });

  it("does NOT claim an inline block: surface (it renders in the transcript)", () => {
    expect(renderWith([a2uiSurface("block:kpis", "m1")])).toEqual({
      kind: "none",
      id: "none",
    });
  });

  it("keeps an earlier report surface when a later block: surface arrives", () => {
    expect(
      renderWith([
        a2uiSurface("keel-ops-report-x1", "m1"),
        a2uiSurface("block:kpis", "m2"),
      ]),
    ).toEqual({ kind: "report", id: "m1" });
  });

  it("claims an id-less OGUI surface instead of discarding it", () => {
    const { kind, id } = renderWith([
      a2uiSurface("keel-ops-report-x1", "m1"),
      { role: "activity", activityType: "open-generative-ui" },
    ]);
    expect(kind).toBe("ogui");
    expect(id).not.toBe("none");
  });
});

describe("classification of malformed a2ui-surface content", () => {
  it("never claims the canvas for content it cannot parse", () => {
    for (const content of [
      undefined,
      null,
      "not json at all",
      42,
      {},
      { a2ui_operations: "nope" },
      { a2ui_operations: [] },
      { a2ui_operations: [null, { createSurface: {} }, { unknownOp: 1 }] },
    ]) {
      expect(renderWith([surfaceWithContent(content, "m1")])).toEqual({
        kind: "none",
        id: "none",
      });
      cleanup();
    }
  });

  it("does NOT claim a stringified block: surface", () => {
    expect(
      renderWith([
        surfaceWithContent(JSON.stringify(opsFor("block:kpis")), "m1"),
      ]),
    ).toEqual({ kind: "none", id: "none" });
  });

  it("does NOT claim a stringified report surface either (nothing could render it)", () => {
    expect(
      renderWith([
        surfaceWithContent(JSON.stringify(opsFor("keel-ops-report-x1")), "m1"),
      ]),
    ).toEqual({ kind: "none", id: "none" });
  });

  it("finds a block: surfaceId that is not in the FIRST op", () => {
    expect(
      renderWith([
        surfaceWithContent(
          {
            a2ui_operations: [
              { beginRendering: {} },
              { createSurface: { surfaceId: "block:kpis" } },
            ],
          },
          "m1",
        ),
      ]),
    ).toEqual({ kind: "none", id: "none" });
  });

  it("keeps an earlier report surface when a later activity is unparseable", () => {
    expect(
      renderWith([
        a2uiSurface("keel-ops-report-x1", "m1"),
        surfaceWithContent("<<garbage>>", "m2"),
      ]),
    ).toEqual({ kind: "report", id: "m1" });
  });

  it("classifies content directly", () => {
    expect(classifyA2uiSurface(opsFor("keel-ops-report-x1"))).toBe("canvas");
    expect(classifyA2uiSurface(opsFor("block:kpis"))).toBe("inline-block");
    expect(classifyA2uiSurface(JSON.stringify(opsFor("block:kpis")))).toBe(
      "inline-block",
    );
    expect(
      classifyA2uiSurface(JSON.stringify(opsFor("keel-ops-report-x1"))),
    ).toBe("unclassifiable");
    expect(classifyA2uiSurface("<<garbage>>")).toBe("unclassifiable");
    expect(classifyA2uiSurface({ a2ui_operations: [{}] })).toBe(
      "unclassifiable",
    );
  });
});

describe("the ← Back dismiss latch", () => {
  it("clears the active surface", () => {
    const view = mount([a2uiSurface("keel-ops-report-x1", "m1")]);
    expect(view.read()).toEqual({ kind: "report", id: "m1" });
    view.dismiss();
    expect(view.read()).toEqual({ kind: "none", id: "none" });
  });

  it("does not suppress a LATER surface with its own id", () => {
    const view = mount([a2uiSurface("keel-ops-report-x1", "m1")]);
    view.dismiss();
    view.push(a2uiSurface("keel-ops-report-x2", "m2"));
    expect(view.read()).toEqual({ kind: "report", id: "m2" });
  });

  it("does not suppress a LATER id-less surface", () => {
    const view = mount([idlessSurface("keel-ops-report-x1")]);
    expect(view.read().kind).toBe("report");
    view.dismiss();
    expect(view.read()).toEqual({ kind: "none", id: "none" });
    view.push(idlessSurface("keel-ops-report-x2"));
    expect(view.read().kind).toBe("report");
  });
});

describe("agent message envelope drift", () => {
  it("detects nothing and warns once when agent.messages is not an array", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = mount({ items: [] } as unknown as unknown[]);
    expect(view.read()).toEqual({ kind: "none", id: "none" });
    view.rerender();
    // Loud once, not once per render.
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
