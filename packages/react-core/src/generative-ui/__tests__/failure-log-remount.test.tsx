import React, { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import { domGenerativeUIHost } from "../host";
import {
  createHarness,
  expectContained,
  reported,
} from "./containment-harness";

// I2 of the containment contract (see host-containment-matrix): each
// distinct failure is reported once per place until its content changes.
// The memory of what a place reported must survive what React does to
// mounted components without new content: StrictMode running every effect
// twice, <Activity> hiding and showing a subtree, and an ancestor that
// remounts its children (a parent sent again with another type).

function Pair({ a }: { a: string }) {
  return <span data-testid="pair">{a}</span>;
}
function Broken({ label }: { label: string }): ReactNode {
  throw new Error(`exploded ${label.length}`);
}
function Field({
  value,
  setValue,
}: {
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <input
      aria-label="field"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
function Box({ children }: { children?: ReactNode }) {
  return <div data-testid="box">{children}</div>;
}
/** Hides its children with <Activity> when the test says so. */
let setHiderMode: ((mode: "visible" | "hidden") => void) | undefined;
function Hider({ children }: { children?: ReactNode }) {
  const [mode, set] = useState<"visible" | "hidden">("visible");
  setHiderMode = set;
  const Hideable = Activity!;
  return <Hideable mode={mode}>{children}</Hideable>;
}

const ui = createGenerativeUI({
  id: "failure-log-remount",
  components: {
    Pair: { component: Pair, props: z.object({ a: z.string() }) },
    Broken: { component: Broken, props: z.object({ label: z.string() }) },
    Text: { component: Pair, props: z.object({ a: z.string() }) },
    Box: { component: Box, slots: { children: "multiple" } },
    // The same slots as Box: a type change remounts the children.
    Box2: { component: Box, slots: { children: "multiple" } },
    Hider: { component: Hider, slots: { children: "multiple" } },
    Field: {
      component: Field,
      props: z.object({ value: z.string().default("") }),
      writable: ["value"],
    },
  },
});

const { renderWithHost } = createHarness(ui, "failure-log-remount");

// React 19.2's <Activity>; the installed React types predate it.
const Activity = (
  React as unknown as {
    Activity?: ComponentType<{
      mode: "visible" | "hidden";
      children: ReactNode;
    }>;
  }
).Activity;

const SIBLING: A2UIComponentNode = { id: "ok", component: "Text", a: "here" };
const bad = { "@path": "/bad" };
const data = { "/bad": 1 };

function root(...children: string[]): A2UIComponentNode {
  return { id: "root", component: "Box", children };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const count = (harness: { reportError: ReturnType<typeof vi.fn> }) =>
  reported(harness.reportError).length;

describe("the failure log across StrictMode", () => {
  it("reports invalid props once", () => {
    const harness = renderWithHost(
      domGenerativeUIHost,
      [root("x", "ok"), { id: "x", component: "Pair", a: bad }, SIBLING],
      { data, strict: true },
    );
    expect(reported(harness.reportError)).toEqual([
      expect.objectContaining({ kind: "props", componentId: "x" }),
    ]);
    // A new revision with the same problem: the same failure.
    harness.push({ id: "x", component: "Pair", a: bad });
    expect(count(harness)).toBe(1);
    // Fixed, then broken again: a new failure.
    harness.push({ id: "x", component: "Pair", a: "fine" });
    harness.push({ id: "x", component: "Pair", a: bad });
    expect(count(harness)).toBe(2);
    expectContained(harness.onEscape);
  });

  it("reports a render failure once across revisions", () => {
    const harness = renderWithHost(
      domGenerativeUIHost,
      [root("x", "ok"), { id: "x", component: "Broken", label: "a" }, SIBLING],
      { strict: true },
    );
    expect(count(harness)).toBe(1);
    // Throws the same error again.
    harness.push({ id: "x", component: "Broken", label: "b" });
    expect(count(harness)).toBe(1);
    expectContained(harness.onEscape);
  });
});

describe("the failure log across an ancestor remount", () => {
  it("does not report unchanged invalid props of a child again", () => {
    const harness = renderWithHost(
      domGenerativeUIHost,
      [
        root("p", "ok"),
        { id: "p", component: "Box", children: ["x"] },
        { id: "x", component: "Pair", a: bad },
        SIBLING,
      ],
      { data },
    );
    expect(count(harness)).toBe(1);
    harness.push({ id: "p", component: "Box2", children: ["x"] });
    expect(count(harness)).toBe(1);
    expectContained(harness.onEscape);
  });

  it("does not report an unchanged render failure of a child again", () => {
    const harness = renderWithHost(domGenerativeUIHost, [
      root("p", "ok"),
      { id: "p", component: "Box", children: ["x"] },
      { id: "x", component: "Broken", label: "a" },
      SIBLING,
    ]);
    expect(count(harness)).toBe(1);
    harness.push({ id: "p", component: "Box2", children: ["x"] });
    expect(count(harness)).toBe(1);
    expectContained(harness.onEscape);
  });

  it("still reports a failing node that went away and came back", () => {
    const harness = renderWithHost(
      domGenerativeUIHost,
      [
        root("p", "ok"),
        { id: "p", component: "Box", children: ["x"] },
        { id: "x", component: "Pair", a: bad },
        SIBLING,
      ],
      { data, strict: true },
    );
    expect(count(harness)).toBe(1);
    harness.push({ id: "p", component: "Box", children: [] });
    harness.push({ id: "p", component: "Box", children: ["x"] });
    expect(count(harness)).toBe(2);
    expectContained(harness.onEscape);
  });
});

describe("the failure log across <Activity>", () => {
  it.skipIf(!Activity)(
    "does not report invalid props again when a hidden surface is shown",
    () => {
      const Hideable = Activity!;
      let setMode: ((mode: "visible" | "hidden") => void) | undefined;
      function Toggle({ children }: { children: ReactNode }) {
        const [mode, set] = useState<"visible" | "hidden">("visible");
        setMode = set;
        return <Hideable mode={mode}>{children}</Hideable>;
      }
      const harness = renderWithHost(
        domGenerativeUIHost,
        [root("x", "ok"), { id: "x", component: "Pair", a: bad }, SIBLING],
        { data, wrap: (tree) => <Toggle>{tree}</Toggle> },
      );
      expect(count(harness)).toBe(1);
      act(() => setMode?.("hidden"));
      act(() => setMode?.("visible"));
      expect(count(harness)).toBe(1);
      expect(screen.getByTestId("pair").textContent).toBe("here");
      expectContained(harness.onEscape);
    },
  );

  for (const strict of [false, true]) {
    it.skipIf(!Activity)(
      `reports invalid props again when new content arrived while the surface was hidden${strict ? " (StrictMode)" : ""}`,
      () => {
        const Hideable = Activity!;
        let setMode: ((mode: "visible" | "hidden") => void) | undefined;
        function Toggle({ children }: { children: ReactNode }) {
          const [mode, set] = useState<"visible" | "hidden">("visible");
          setMode = set;
          return <Hideable mode={mode}>{children}</Hideable>;
        }
        const harness = renderWithHost(
          domGenerativeUIHost,
          [root("x", "ok"), { id: "x", component: "Pair", a: bad }, SIBLING],
          { data, strict, wrap: (tree) => <Toggle>{tree}</Toggle> },
        );
        expect(count(harness)).toBe(1);
        act(() => setMode?.("hidden"));
        harness.push(SIBLING);
        act(() => setMode?.("visible"));
        expect(count(harness)).toBe(2);
        expectContained(harness.onEscape);
      },
    );
  }
});

describe("the failure log of a surface hidden with <Activity> while content arrives", () => {
  for (const strict of [false, true]) {
    it.skipIf(!Activity)(
      `reports a render failure again${strict ? " (StrictMode)" : ""}`,
      () => {
        const Hideable = Activity!;
        let setMode: ((mode: "visible" | "hidden") => void) | undefined;
        function Toggle({ children }: { children: ReactNode }) {
          const [mode, set] = useState<"visible" | "hidden">("visible");
          setMode = set;
          return <Hideable mode={mode}>{children}</Hideable>;
        }
        const harness = renderWithHost(
          domGenerativeUIHost,
          [
            root("x", "ok"),
            { id: "x", component: "Broken", label: "a" },
            SIBLING,
          ],
          { strict, wrap: (tree) => <Toggle>{tree}</Toggle> },
        );
        expect(count(harness)).toBe(1);
        act(() => setMode?.("hidden"));
        // New content of this surface while the whole surface is hidden.
        harness.push(SIBLING);
        act(() => setMode?.("visible"));
        expect(count(harness)).toBe(2);
        expectContained(harness.onEscape);
      },
    );
  }
});

describe("the failure log of a failed fallback hidden with <Activity> while content arrives", () => {
  for (const strict of [false, true]) {
    it.skipIf(!Activity)(
      `reports the fallback's failure again${strict ? " (StrictMode)" : ""}`,
      () => {
        const Hideable = Activity!;
        let setMode: ((mode: "visible" | "hidden") => void) | undefined;
        function Toggle({ children }: { children: ReactNode }) {
          const [mode, set] = useState<"visible" | "hidden">("visible");
          setMode = set;
          return <Hideable mode={mode}>{children}</Hideable>;
        }
        const throwingHost = {
          ...domGenerativeUIHost,
          NodeFallback: (): ReactNode => {
            throw new Error("fallback exploded");
          },
        };
        const harness = renderWithHost(
          throwingHost,
          [
            root("x", "ok"),
            { id: "x", component: "Broken", label: "a" },
            SIBLING,
          ],
          { strict, wrap: (tree) => <Toggle>{tree}</Toggle> },
        );
        const fallbackReports = () =>
          reported(harness.reportError).filter((info) =>
            info.error.message.includes("fallback exploded"),
          ).length;
        expect(fallbackReports()).toBe(1);
        // Shown again without new content: nothing is reported again.
        act(() => setMode?.("hidden"));
        act(() => setMode?.("visible"));
        expect(fallbackReports()).toBe(1);
        // New content of this surface while the whole surface is hidden.
        act(() => setMode?.("hidden"));
        harness.push(SIBLING);
        act(() => setMode?.("visible"));
        expect(fallbackReports()).toBe(2);
        expectContained(harness.onEscape);
      },
    );
  }
});

/** Content of another surface, with nothing to do with this one. */
const otherSurface = (status: "streaming" | "ready" = "streaming") => ({
  surfaceId: "s2",
  target: "inline",
  catalogId: "failure-log-remount",
  operations: [
    {
      version: "1.0" as const,
      createSurface: { surfaceId: "s2", catalogId: "failure-log-remount" },
    },
  ],
  status,
  rejected: [],
});

describe("the failure log of a child hidden with <Activity>", () => {
  const hidden = [
    root("h", "ok"),
    { id: "h", component: "Hider", children: ["x"] },
    { id: "x", component: "Pair", a: bad },
    SIBLING,
  ];
  for (const strict of [false, true]) {
    it.skipIf(!Activity)(
      `keeps its memory across updates of other surfaces${strict ? " (StrictMode)" : ""}`,
      () => {
        const harness = renderWithHost(domGenerativeUIHost, hidden, {
          data,
          strict,
        });
        expect(count(harness)).toBe(1);
        act(() => setHiderMode?.("hidden"));
        // Other surfaces stream, and this one is delivered again with no
        // new content: none of it is new content of this surface.
        act(() => harness.manager.ingest("t1", "default", otherSurface()));
        act(() =>
          harness.manager.ingest("t1", "default", otherSurface("ready")),
        );
        harness.reingest();
        act(() => setHiderMode?.("visible"));
        expect(count(harness)).toBe(1);
        expect(screen.getByTestId("pair").textContent).toBe("here");
        expectContained(harness.onEscape);
      },
    );
  }

  for (const strict of [false, true]) {
    it.skipIf(!Activity)(
      `keeps its memory while the user writes to the surface's data and the app sets state${strict ? " (StrictMode)" : ""}`,
      () => {
        // The failing node is hidden. The user types into another bound
        // input on the same surface, and the app sets a state key: none of
        // it is new content, so when the node is shown again with the same
        // content, its failure is not reported again.
        const harness = renderWithHost(
          domGenerativeUIHost,
          [
            root("h", "f", "ok"),
            { id: "h", component: "Hider", children: ["x"] },
            { id: "x", component: "Pair", a: bad },
            { id: "f", component: "Field", value: { "@path": "/name" } },
            SIBLING,
          ],
          { data: { ...data, "/name": "" }, strict },
        );
        expect(count(harness)).toBe(1);
        act(() => setHiderMode?.("hidden"));
        const input = screen.getByLabelText("field") as HTMLInputElement;
        act(() => {
          fireEvent.change(input, { target: { value: "Ada" } });
        });
        act(() => {
          fireEvent.change(input, { target: { value: "Ada L" } });
        });
        expect(input.value).toBe("Ada L");
        act(() => harness.manager.setState("draft", { name: "Ada L" }));
        act(() => harness.manager.setState("draft", { name: "Ada" }));
        act(() => setHiderMode?.("visible"));
        expect(count(harness)).toBe(1);
        expect(screen.getByTestId("pair").textContent).toBe("here");
        expectContained(harness.onEscape);
      },
    );
  }

  it.skipIf(!Activity)(
    "forgets it once new content of the surface arrives",
    () => {
      const harness = renderWithHost(domGenerativeUIHost, hidden, { data });
      expect(count(harness)).toBe(1);
      act(() => setHiderMode?.("hidden"));
      harness.push(SIBLING);
      act(() => setHiderMode?.("visible"));
      expect(count(harness)).toBe(2);
      expectContained(harness.onEscape);
    },
  );
});

describe("the place of a node", () => {
  it("does not mistake an id holding place separators for a nested child", () => {
    // Under the old encoding, the id "x/children:#y" under root and "y"
    // under "x" had the same place, and shared one failure-log slot.
    const harness = renderWithHost(
      domGenerativeUIHost,
      [
        root("x", "x/children:#y", "ok"),
        { id: "x", component: "Box", children: ["y"] },
        { id: "y", component: "Pair", a: bad },
        { id: "x/children:#y", component: "Pair", a: bad },
        SIBLING,
      ],
      { data },
    );
    expect(
      reported(harness.reportError)
        .map((info) => info.componentId)
        .sort(),
    ).toEqual(["x/children:#y", "y"]);
    expectContained(harness.onEscape);
  });
});
