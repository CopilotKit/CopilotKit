import React, { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import { domGenerativeUIHost } from "../host";
import type { GenerativeUIHost } from "../host";
import type { GenerativeUIErrorBoundaryConfig } from "../runtime-context";
import {
  createHarness,
  expectContained,
  hostThrowingFor,
  reported,
  S,
} from "./containment-harness";

// The containment contract of a surface, cell by cell:
//   I1  nothing escapes the surface, whatever is thrown and wherever;
//   I2  each distinct failure is reported once, as an Error;
//   I3  a failed piece gets another chance when the node or the surface
//       really changes (a new revision, a new message, Retry), and not when
//       the same content is delivered again.
//
// Axes: where the fault throws × why the node is in a fallback × what is
// thrown × what happens next. Combinations that cannot happen are listed in
// SKIPPED with the reason.

/** The one fault of a cell. */
const fault = {
  armed: true,
  value: undefined as unknown,
  /** How many times the faulty piece ran. */
  attempts: 0,
  raise(): void {
    fault.attempts++;
    if (fault.armed) throw fault.value;
  },
};
/** The error of the `Broken` component, which a fallback stands in for. */
const broken = { armed: true, message: "component exploded" };

function Faulty({ label }: { label: string }) {
  fault.raise();
  return <span data-testid="healed">{label}</span>;
}
function Broken({ label }: { label: string }): ReactNode {
  if (broken.armed) throw new Error(broken.message);
  return <span data-testid="healed">{label}</span>;
}
function Label({ label }: { label: string }) {
  return <span data-testid="label">{label}</span>;
}
function Pair({ a, b }: { a: string; b?: string }) {
  return (
    <span data-testid="healed">
      {a}
      {b}
    </span>
  );
}
function Box({ children }: { children?: ReactNode }) {
  return <div data-testid="box">{children}</div>;
}
/** Which parent a node renders under, for `Picky`. */
const LaneContext = createContext("");
function Lane({ lane, children }: { lane: string; children?: ReactNode }) {
  return <LaneContext.Provider value={lane}>{children}</LaneContext.Provider>;
}
/** Throws under the "bad" lane only: one copy fails, the other renders. */
function Picky({ label }: { label: string }) {
  if (useContext(LaneContext) === "bad") throw new Error("picky exploded");
  return <span data-testid="picky">{label}</span>;
}
function Panel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      {title}
      {children}
    </div>
  );
}

const ui = createGenerativeUI({
  id: "containment-matrix",
  components: {
    Faulty: { component: Faulty, props: z.object({ label: z.string() }) },
    Broken: { component: Broken, props: z.object({ label: z.string() }) },
    Text: { component: Label, props: z.object({ label: z.string() }) },
    Pair: {
      component: Pair,
      props: z.object({ a: z.string(), b: z.string().optional() }),
    },
    // Accepted by the catalog, unknown to the renderer (hidden types).
    Mystery: { component: Label, props: z.object({ label: z.string() }) },
    Mystery2: { component: Label, props: z.object({ label: z.string() }) },
    Box: { component: Box, slots: { children: "multiple" } },
    Lane: {
      component: Lane,
      props: z.object({ lane: z.string() }),
      slots: { children: "multiple" },
    },
    Picky: { component: Picky, props: z.object({ label: z.string() }) },
    Panel: {
      component: Panel,
      props: z.object({ title: z.string() }),
      slots: { children: "multiple" },
    },
    // The same props as Pair: a type change keeps an invalid-props problem.
    Pair2: {
      component: Pair,
      props: z.object({ a: z.string(), b: z.string().optional() }),
    },
  },
});

const { renderWithHost } = createHarness(ui, "containment-matrix");

type Site =
  | "component"
  | "app errorFallback"
  | "host NodeFallback"
  | "SurfaceRoot"
  | "AccessibilityWrapper"
  | "surface lookup";
type Path = "render error" | "invalid props" | "unknown type" | "cycle";
type FollowUp =
  | "same message"
  | "new message"
  | "re-ingest same content"
  | "new content";

const SITES: Site[] = [
  "component",
  "app errorFallback",
  "host NodeFallback",
  "SurfaceRoot",
  "AccessibilityWrapper",
  "surface lookup",
];
const PATHS: Path[] = [
  "render error",
  "invalid props",
  "unknown type",
  "cycle",
];
const FOLLOW_UPS: FollowUp[] = [
  "same message",
  "new message",
  "re-ingest same content",
  "new content",
];
const VALUES: Array<[string, unknown]> = [
  ["Error", new Error("fault")],
  ["string", "boom"],
  ["undefined", undefined],
  ["null", null],
  ["0", 0],
  ["empty string", ""],
];

/** The message of the Error that a thrown value is reported as. */
function messageOf(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string" && value !== "") return value;
  const shown =
    typeof value === "string" ? JSON.stringify(value) : String(value);
  return `A value that is not an Error was thrown: ${shown}`;
}

const SKIPPED: Partial<Record<Site, Partial<Record<Path, string>>>> = {
  component: {
    "invalid props": "the component does not render with invalid props",
    "unknown type": "an unknown type has no component",
    cycle: "a cyclic reference renders no component",
  },
  "app errorFallback": {
    "invalid props": "the app fallback is for render failures only",
    "unknown type": "the app fallback is for render failures only",
    cycle: "the app fallback is for render failures only",
  },
  SurfaceRoot: {
    "invalid props": "no node renders while the root throws",
    "unknown type": "no node renders while the root throws",
    cycle: "no node renders while the root throws",
  },
  AccessibilityWrapper: {
    "invalid props": "the wrapper is not drawn for invalid props",
    "unknown type": "the wrapper is not drawn for an unknown type",
    cycle: "the wrapper is not drawn for a cyclic reference",
  },
  "surface lookup": {
    "invalid props": "the lookup fails before any node is checked",
    "unknown type": "the lookup fails before any node is checked",
    cycle: "the lookup fails before any node is checked",
  },
};

/** Follow-ups that cannot be built for a cell, with the reason. */
function skippedFollowUp(path: Path, followUp: FollowUp) {
  if (path === "cycle" && followUp === "new message") {
    return "the message of a cycle names only the node, which stays the same";
  }
  return undefined;
}

const SIBLING: A2UIComponentNode = {
  id: "ok",
  component: "Text",
  label: "still here",
};
/** The healthy node "x" of the surface. */
const HEALTHY: A2UIComponentNode = { id: "x", component: "Pair", a: "fine" };

/**
 * One cell: how to build it, what it reports at first, and what each
 * follow-up does.
 */
interface Cell {
  /** The nodes of the surface: root Box with "x" and a sibling "ok". */
  nodes: A2UIComponentNode[];
  host: GenerativeUIHost;
  errorFallback?: GenerativeUIErrorBoundaryConfig["fallback"];
  hiddenTypes?: string[];
  data?: Record<string, unknown>;
  armLookups?: boolean;
  lookupFault?: () => unknown;
  /** The reports of the first render. */
  initial: Array<{ componentId?: string; message: string; kind?: string }>;
  /** The node "x" again, failing with the same message. */
  sameMessage: () => A2UIComponentNode[];
  /** The node "x" again, failing with another message (or a new value). */
  newMessage: () => A2UIComponentNode[];
  /** The reports a new message adds. */
  newMessageReports: Array<{
    componentId?: string;
    message: string;
    kind?: string;
  }>;
  /** True when the whole surface failed (a new content resets it). */
  surfaceLevel: boolean;
  /** The fallback offers Retry. */
  retry: boolean;
}

/** The node "x" with an accessibility envelope, so the wrapper draws. */
function wrapped(label: string): A2UIComponentNode {
  return {
    id: "x",
    component: "Pair",
    a: label,
    accessibility: { label: "x" },
  };
}

function root(...children: string[]): A2UIComponentNode {
  return { id: "root", component: "Box", children };
}

function throwingHost(
  part: "SurfaceRoot" | "AccessibilityWrapper" | "NodeFallback",
) {
  const host: GenerativeUIHost = { ...domGenerativeUIHost };
  if (part === "SurfaceRoot") {
    const Root = domGenerativeUIHost.SurfaceRoot;
    host.SurfaceRoot = (props) => {
      fault.raise();
      return <Root {...props} />;
    };
  } else if (part === "AccessibilityWrapper") {
    const Wrapper = domGenerativeUIHost.AccessibilityWrapper;
    host.AccessibilityWrapper = (props) => {
      fault.raise();
      return <Wrapper {...props} />;
    };
  } else {
    const Fallback = domGenerativeUIHost.NodeFallback;
    host.NodeFallback = (props) => {
      if (props.componentId === "x") fault.raise();
      return <Fallback {...props} />;
    };
  }
  return host;
}

const fallbackOf = (id: string, value: unknown) =>
  `The error fallback of ${id} threw: ${messageOf(value)}`;

function buildCell(site: Site, path: Path, value: unknown): Cell {
  const second = new Error("second fault");
  const sendSecond = () => {
    fault.value = second;
  };
  if (site === "component") {
    return {
      nodes: [
        root("x", "ok"),
        { id: "x", component: "Faulty", label: "v1" },
        SIBLING,
      ],
      host: domGenerativeUIHost,
      initial: [{ componentId: "x", message: messageOf(value) }],
      sameMessage: () => [{ id: "x", component: "Faulty", label: "v2" }],
      newMessage: () => {
        sendSecond();
        return [{ id: "x", component: "Faulty", label: "v3" }];
      },
      newMessageReports: [{ componentId: "x", message: "second fault" }],
      surfaceLevel: false,
      retry: true,
    };
  }
  if (site === "app errorFallback") {
    return {
      nodes: [
        root("x", "ok"),
        { id: "x", component: "Broken", label: "v1" },
        SIBLING,
      ],
      host: domGenerativeUIHost,
      errorFallback: () => {
        fault.raise();
        return <div data-testid="app-fallback" />;
      },
      initial: [
        { componentId: "x", message: "component exploded" },
        { componentId: "x", message: fallbackOf("x", value) },
      ],
      sameMessage: () => [{ id: "x", component: "Broken", label: "v2" }],
      newMessage: () => {
        broken.message = "component exploded again";
        return [{ id: "x", component: "Broken", label: "v3" }];
      },
      // The component's new error, and the app fallback that throws while
      // standing in for it: a new failure of the fallback too.
      newMessageReports: [
        { componentId: "x", message: "component exploded again" },
        { componentId: "x", message: fallbackOf("x", value) },
      ],
      surfaceLevel: false,
      retry: true,
    };
  }
  if (site === "SurfaceRoot" || site === "surface lookup") {
    return {
      nodes: [root("x", "ok"), HEALTHY, SIBLING],
      host:
        site === "SurfaceRoot"
          ? throwingHost("SurfaceRoot")
          : domGenerativeUIHost,
      armLookups: site === "surface lookup",
      lookupFault: () => {
        fault.attempts++;
        return fault.value;
      },
      initial: [{ message: messageOf(value) }],
      sameMessage: () => [{ ...HEALTHY, a: "v2" }],
      newMessage: () => {
        sendSecond();
        return [{ ...HEALTHY, a: "v3" }];
      },
      newMessageReports: [{ message: "second fault" }],
      surfaceLevel: true,
      // Only the boundary around the host's root offers Retry; the one
      // inside it keeps the web output of a failed surface (no button).
      retry: site === "SurfaceRoot",
    };
  }
  if (site === "AccessibilityWrapper") {
    return {
      nodes: [root("x", "ok"), wrapped("v1"), SIBLING],
      host: throwingHost("AccessibilityWrapper"),
      initial: [{ componentId: "x", message: messageOf(value) }],
      sameMessage: () => [wrapped("v2")],
      newMessage: () => {
        sendSecond();
        return [wrapped("v3")];
      },
      newMessageReports: [{ componentId: "x", message: "second fault" }],
      surfaceLevel: false,
      retry: true,
    };
  }
  // The host's NodeFallback throws, on each path.
  const host = throwingHost("NodeFallback");
  if (path === "render error") {
    return {
      nodes: [
        root("x", "ok"),
        { id: "x", component: "Broken", label: "v1" },
        SIBLING,
      ],
      host,
      initial: [
        { componentId: "x", message: "component exploded" },
        { componentId: "x", message: fallbackOf("x", value) },
      ],
      sameMessage: () => [{ id: "x", component: "Broken", label: "v2" }],
      newMessage: () => {
        broken.message = "component exploded again";
        return [{ id: "x", component: "Broken", label: "v3" }];
      },
      // The component's new error, and the fallback that throws for it.
      newMessageReports: [
        { componentId: "x", message: "component exploded again" },
        { componentId: "x", message: fallbackOf("x", value) },
      ],
      surfaceLevel: false,
      retry: false,
    };
  }
  if (path === "invalid props") {
    // The data model has a number where the props want a string: the
    // manager cannot see that, the renderer reports invalid props.
    const bad = { "@path": "/bad" };
    return {
      nodes: [root("x", "ok"), { id: "x", component: "Pair", a: bad }, SIBLING],
      host,
      data: { "/bad": 1 },
      initial: [
        { componentId: "x", message: "Invalid props", kind: "props" },
        { componentId: "x", message: fallbackOf("x", value) },
      ],
      sameMessage: () => [{ id: "x", component: "Pair", a: bad }],
      newMessage: () => [{ id: "x", component: "Pair", a: "fine", b: bad }],
      newMessageReports: [
        { componentId: "x", message: "Invalid props", kind: "props" },
        { componentId: "x", message: fallbackOf("x", value) },
      ],
      surfaceLevel: false,
      retry: false,
    };
  }
  if (path === "unknown type") {
    return {
      nodes: [
        root("x", "ok"),
        { id: "x", component: "Mystery", label: "1" },
        SIBLING,
      ],
      host,
      hiddenTypes: ["Mystery", "Mystery2"],
      initial: [{ componentId: "x", message: fallbackOf("x", value) }],
      sameMessage: () => [{ id: "x", component: "Mystery", label: "2" }],
      newMessage: () => [{ id: "x", component: "Mystery2", label: "3" }],
      newMessageReports: [
        { componentId: "x", message: fallbackOf("x", value) },
      ],
      surfaceLevel: false,
      retry: false,
    };
  }
  // A cycle: x → y → x. The second x is the cyclic reference.
  return {
    nodes: [
      root("x", "ok"),
      { id: "x", component: "Box", children: ["y"] },
      { id: "y", component: "Box", children: ["x"] },
      SIBLING,
    ],
    host,
    initial: [{ componentId: "x", message: fallbackOf("x", value) }],
    // The same cycle sent again: x is a new revision.
    sameMessage: () => [{ id: "x", component: "Box", children: ["y"] }],
    newMessage: () => [],
    newMessageReports: [],
    surfaceLevel: false,
    retry: false,
  };
}

function expectReports(
  actual: ReturnType<typeof reported>,
  expected: Cell["initial"],
) {
  expect(actual).toHaveLength(expected.length);
  for (const info of actual) {
    expect(info.error).toBeInstanceOf(Error);
    expect(info.surfaceId).toBe(S);
  }
  for (const want of expected) {
    expect(actual).toContainEqual(
      expect.objectContaining({
        kind: want.kind ?? "render",
        ...(want.componentId === undefined
          ? {}
          : { componentId: want.componentId }),
        error: expect.objectContaining({
          message:
            want.kind === "props"
              ? expect.stringContaining(want.message)
              : want.message,
        }),
      }),
    );
  }
}

describe("generative UI containment matrix", () => {
  beforeEach(() => {
    fault.armed = true;
    fault.attempts = 0;
    broken.armed = true;
    broken.message = "component exploded";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const site of SITES) {
    for (const path of PATHS) {
      const skip = SKIPPED[site]?.[path];
      if (skip) {
        it.skip(`${site} × ${path}: ${skip}`, () => {});
        continue;
      }
      describe(`${site} × ${path}`, () => {
        for (const [valueName, value] of VALUES) {
          for (const followUp of FOLLOW_UPS) {
            const skipFollowUp = skippedFollowUp(path, followUp);
            const name = `throws ${valueName}, then ${followUp}`;
            if (skipFollowUp) {
              it.skip(`${name}: ${skipFollowUp}`, () => {});
              continue;
            }
            it(name, () => {
              fault.value = value;
              const cell = buildCell(site, path, value);
              const harness = renderWithHost(cell.host, cell.nodes, {
                errorFallback: cell.errorFallback,
                hiddenTypes: cell.hiddenTypes,
                data: cell.data,
                armLookups: cell.armLookups,
                lookupFault: cell.lookupFault,
              });
              // I1: contained, and for a node, the sibling node renders.
              expectContained(harness.onEscape);
              if (!cell.surfaceLevel) {
                expect(screen.getByTestId("label").textContent).toBe(
                  "still here",
                );
              }
              // I2: reported once, as an Error.
              expectReports(reported(harness.reportError), cell.initial);
              const before = reported(harness.reportError).length;
              const attempts = fault.attempts;

              let added: Cell["initial"] = [];
              let retried: boolean;
              if (followUp === "same message") {
                harness.push(...cell.sameMessage());
                retried = true;
              } else if (followUp === "new message") {
                harness.push(...cell.newMessage());
                added = cell.newMessageReports;
                retried = true;
              } else if (followUp === "re-ingest same content") {
                harness.reingest();
                retried = false;
              } else {
                harness.push({ ...SIBLING, label: "still here, again" });
                // Only a failed surface starts again with new content; a
                // node starts again with a new revision of itself.
                retried = cell.surfaceLevel;
              }
              expectContained(harness.onEscape);
              const after = reported(harness.reportError);
              expectReports(after.slice(before), added);
              // I3: the faulty piece ran again exactly when it should.
              // (The component of the app-fallback and render-error cells is
              // `Broken`; the fault there is the fallback, which runs again
              // with each new error of the component.)
              if (retried) expect(fault.attempts).toBeGreaterThan(attempts);
              else expect(fault.attempts).toBe(attempts);

              // I3: once the fault is gone, the node or the surface comes
              // back, through Retry when the fallback offers it, or else
              // with a new revision.
              fault.armed = false;
              broken.armed = false;
              harness.components.armed = false;
              harness.components.hidden.clear();
              if (cell.retry) {
                const retryButton = screen.getByRole("button", {
                  name: "Retry",
                });
                fireEvent.click(retryButton);
              } else {
                harness.push(root("x", "ok"), HEALTHY);
              }
              expectContained(harness.onEscape);
              expect(screen.getByTestId("healed")).toBeTruthy();
              expect(screen.getByTestId("label")).toBeTruthy();
            });
          }
        }
      });
    }
  }
});

// A node is a place in the tree, not a component id: the same id can render
// under two parents (a, b → c), and a cyclic reference repeats the id of an
// ancestor. Each place keeps its own memory of what it reported (I2), so one
// copy that renders, goes away or remounts does not make another copy's
// failure be reported again.
describe("generative UI containment of a component id rendered in more than one place", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const count = (harness: { reportError: ReturnType<typeof vi.fn> }) =>
    reported(harness.reportError).length;

  it("reports a shared child's failing fallback once per place, and not again when one place goes away", () => {
    const harness = renderWithHost(
      hostThrowingFor("c"),
      [
        root("a", "b", "ok"),
        { id: "a", component: "Box", children: ["c"] },
        { id: "b", component: "Box", children: ["c"] },
        { id: "c", component: "Mystery", label: "1" },
        SIBLING,
      ],
      { hiddenTypes: ["Mystery"] },
    );
    expectContained(harness.onEscape);
    const fallbackThrew = {
      componentId: "c",
      message: "The error fallback of c threw: fallback exploded for c",
    };
    expectReports(reported(harness.reportError), [
      fallbackThrew,
      fallbackThrew,
    ]);
    // The same failure in a new revision of c: nothing new.
    harness.push({ id: "c", component: "Mystery", label: "2" });
    expect(count(harness)).toBe(2);
    // b lets go of c; the copy under a keeps failing the same way.
    harness.push({ id: "b", component: "Box", children: [] });
    harness.push({ id: "c", component: "Mystery", label: "3" });
    expect(count(harness)).toBe(2);
    expectContained(harness.onEscape);
  });

  it("does not let a healthy copy clear the memory of a failing one", () => {
    const harness = renderWithHost(domGenerativeUIHost, [
      root("a", "b", "ok"),
      { id: "a", component: "Lane", lane: "bad", children: ["c"] },
      { id: "b", component: "Lane", lane: "good", children: ["c"] },
      { id: "c", component: "Picky", label: "v1" },
      SIBLING,
    ]);
    expectContained(harness.onEscape);
    expect(screen.getByTestId("picky").textContent).toBe("v1");
    expectReports(reported(harness.reportError), [
      { componentId: "c", message: "picky exploded" },
    ]);
    harness.push({ id: "c", component: "Picky", label: "v2" });
    harness.push({ id: "c", component: "Picky", label: "v3" });
    expect(screen.getByTestId("picky").textContent).toBe("v3");
    expect(count(harness)).toBe(1);
  });

  it("does not let a cyclic child that unmounts clear the memory of its failing ancestor", () => {
    // x → y → x; the host's fallback throws for x, in both places.
    const bad = { "@path": "/bad" };
    const harness = renderWithHost(
      hostThrowingFor("x"),
      [
        root("x", "ok"),
        { id: "x", component: "Panel", title: "fine", children: ["y"] },
        { id: "y", component: "Box", children: ["x"] },
        SIBLING,
      ],
      { data: { "/bad": 1 } },
    );
    const fallbackThrew = {
      componentId: "x",
      message: "The error fallback of x threw: fallback exploded for x",
    };
    // The cyclic x.
    expectReports(reported(harness.reportError), [fallbackThrew]);
    // The ancestor x gets invalid props: its fallback throws, and y and the
    // cyclic x under it unmount.
    harness.push({ id: "x", component: "Panel", title: bad, children: ["y"] });
    expectReports(reported(harness.reportError).slice(1), [
      { componentId: "x", message: "Invalid props", kind: "props" },
      fallbackThrew,
    ]);
    // The same invalid props again: the same failure, nothing new.
    harness.push({ id: "x", component: "Panel", title: bad, children: ["y"] });
    expect(count(harness)).toBe(3);
    expectContained(harness.onEscape);
  });

  it("reports unchanged invalid props once, also when the node remounts", () => {
    const bad = { "@path": "/bad" };
    const harness = renderWithHost(
      domGenerativeUIHost,
      [root("x", "ok"), { id: "x", component: "Pair", a: bad }, SIBLING],
      { data: { "/bad": 1 } },
    );
    expectReports(reported(harness.reportError), [
      { componentId: "x", message: "Invalid props", kind: "props" },
    ]);
    // Another type with the same schema remounts the node (its boundary is
    // keyed by type), with the same problem.
    harness.push({ id: "x", component: "Pair2", a: bad });
    expect(count(harness)).toBe(1);
    // Fixed, then broken again: a new failure.
    harness.push({ id: "x", component: "Pair2", a: "fine" });
    harness.push({ id: "x", component: "Pair2", a: bad });
    expect(count(harness)).toBe(2);
    expectContained(harness.onEscape);
  });
});
