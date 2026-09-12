import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  A2UI_OPERATIONS_KEY,
  buildBlockOps,
} from "@/skins/exec/blocks/build-block-ops";
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

/** Ops whose surfaceId arrives on a LATER op than the first. */
const trailingOps = (surfaceId: string) => ({
  a2ui_operations: [{ beginRendering: {} }, { createSurface: { surfaceId } }],
});

/** One op whose FIRST surface container is empty and whose second carries the id. */
const splitContainerOps = (surfaceId: string) => ({
  a2ui_operations: [{ createSurface: {}, updateComponents: { surfaceId } }],
});

/** An `open-generative-ui` activity carrying arbitrary (possibly junk) content. */
const oguiWithContent = (content: unknown, id?: string) => ({
  ...(id ? { id } : {}),
  role: "activity",
  activityType: "open-generative-ui",
  content,
});

/**
 * An `open-generative-ui` activity. Content is what `useOguiSurface` hands
 * `<OguiCanvas/>`, which renders nothing without it — so the fixture carries a
 * streamed body unless a test is specifically about a body-less one.
 */
const oguiSurface = (id?: string) =>
  oguiWithContent({ html: ["<p>hi</p>"] }, id);

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
    expect(renderWith([oguiSurface("m1")])).toEqual({ kind: "ogui", id: "m1" });
  });

  it("does NOT claim an OGUI activity with no content to render", () => {
    // `<OguiCanvas/>` renders null for a body-less activity, so claiming the
    // region for one buries the page behind a bare "← Back" for nothing.
    for (const content of [undefined, null, "streaming…", 7]) {
      expect(renderWith([oguiWithContent(content, "m1")])).toEqual({
        kind: "none",
        id: "none",
      });
      cleanup();
    }
  });

  /**
   * `<OguiCanvas/>` renders whatever `useOguiSurface` finds LAST in the stream,
   * so an earlier OGUI cannot stand in for a blank latest one — it would be
   * claimed here and still render nothing there.
   */
  it("does NOT fall back to an EARLIER OGUI when the latest one is blank", () => {
    expect(
      renderWith([oguiSurface("m1"), oguiWithContent(undefined, "m2")]),
    ).toEqual({ kind: "none", id: "none" });
  });

  it("keeps an earlier report surface when a later OGUI activity has no content", () => {
    expect(
      renderWith([
        a2uiSurface("keel-ops-report-x1", "m1"),
        oguiWithContent(undefined, "m2"),
      ]),
    ).toEqual({ kind: "report", id: "m1" });
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
      oguiSurface(),
    ]);
    expect(kind).toBe("ogui");
    expect(id).not.toBe("none");
  });
});

describe("classification of malformed a2ui-surface content", () => {
  // One labelled case per payload, so a failure NAMES the payload that broke
  // instead of reporting "expected none, got report" from a loop with no way to
  // tell which entry it was — and so one bad payload no longer hides the rest.
  const unclaimable: [label: string, content: unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ["a non-JSON string", "not json at all"],
    ["a number", 42],
    ["an empty object", {}],
    ["a non-array operations key", { a2ui_operations: "nope" }],
    ["an empty operations list", { a2ui_operations: [] }],
    [
      "ops with no surfaceId anywhere",
      { a2ui_operations: [null, { createSurface: {} }, { unknownOp: 1 }] },
    ],
    [
      "a non-string surfaceId",
      { a2ui_operations: [{ createSurface: { surfaceId: 42 } }] },
    ],
    [
      "a non-object op container",
      { a2ui_operations: [{ createSurface: "block:kpis" }] },
    ],
  ];

  it.each(unclaimable)("never claims the canvas for %s", (_label, content) => {
    expect(renderWith([surfaceWithContent(content, "m1")])).toEqual({
      kind: "none",
      id: "none",
    });
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

  /**
   * DISCRIMINATING both ways: the block case alone proves nothing (an
   * unclassifiable payload is "not claimed" too), so the report case — which
   * MUST claim — carries the weight, and the block case pins the other side.
   */
  it("classifies off a surfaceId that is not in the FIRST op", () => {
    expect(
      renderWith([surfaceWithContent(trailingOps("keel-ops-report-x1"), "m1")]),
    ).toEqual({ kind: "report", id: "m1" });
    expect(classifyA2uiSurface(trailingOps("block:kpis"))).toBe("inline-block");
  });

  /**
   * `createSurface ?? updateComponents ?? updateDataModel` stops at the first
   * container that merely EXISTS — so an op carrying an empty `createSurface`
   * beside a real `updateComponents` classified as junk, and a report that had
   * to take the canvas silently did not.
   */
  it("classifies off a LATER container when the first one has no surfaceId", () => {
    expect(
      renderWith([
        surfaceWithContent(splitContainerOps("keel-ops-report-x1"), "m1"),
      ]),
    ).toEqual({ kind: "report", id: "m1" });
    expect(classifyA2uiSurface(splitContainerOps("block:kpis"))).toBe(
      "inline-block",
    );
  });

  /**
   * ONE HOME. A list carrying a block surface AND a report surface must not
   * both render inline and claim the region; the canvas bias wins, and the
   * chat's reader (`blockSurfaceIdFrom`, which shares this decision) must agree
   * — see `inline-block-surface.test.ts` for the other half of that assertion.
   */
  it("gives a mixed block+report op list exactly one home", () => {
    expect(
      renderWith([
        surfaceWithContent(
          {
            a2ui_operations: [
              { createSurface: { surfaceId: "block:kpis" } },
              { updateComponents: { surfaceId: "keel-ops-report-x1" } },
            ],
          },
          "m1",
        ),
      ]),
    ).toEqual({ kind: "report", id: "m1" });
  });

  /**
   * DRIFT GUARD for the second (and last) copy of `BLOCK_SURFACE_PREFIX`. The
   * exec skin MINTS block surface ids in `src/skins/exec/blocks/build-block-ops.ts`;
   * this module re-spells the prefix because the shell must not import from
   * `src/skins/`. Asserting our constant against itself proves nothing — this
   * runs REAL minted ops through the shell's classifier, so either copy
   * drifting (prefix or operations key) fails here instead of silently flipping
   * an inline tile into a page-blanking report claim.
   *
   * (`build-block-ops.test.ts` runs the same ops through the chat's reader; the
   * two together cover both shell-side readers of the convention.)
   */
  it("classifies REAL minted exec block ops as inline, not canvas", () => {
    const ops = buildBlockOps(
      { kind: "metricTile", title: "Revenue", metricId: "revenue" } as const,
      "b1",
    );
    const content = { [A2UI_OPERATIONS_KEY]: ops };
    expect(classifyA2uiSurface(content)).toBe("inline-block");
    expect(renderWith([surfaceWithContent(content, "m1")])).toEqual({
      kind: "none",
      id: "none",
    });
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
    // Once per provider, not once per render.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  /**
   * The latch is PER PROVIDER, not per process: this module is imported once
   * per server process, so a process-wide latch would let the first SSR render
   * that ever drifted silence the warning for every request after it — and for
   * every unrelated test in this file's run.
   */
  it("warns again for a SEPARATE provider instance", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount({ items: [] } as unknown as unknown[]);
    cleanup();
    mount({ items: [] } as unknown as unknown[]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
