import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Message } from "@ag-ui/client";
import { createGenerativeUI } from "../catalog";
import { child } from "../refs";
import {
  buildMarkdownSurfaces,
  MarkdownSurfaceSource,
} from "../markdown/source";
import { GenerativeUISurfaceManager } from "../surface-manager";

const Noop = () => null;
const ui = createGenerativeUI({
  id: "app",
  functions: {
    addToCart: { parameters: z.object({ sku: z.string() }) },
  },
  components: {
    Column: { component: Noop, slots: { children: "multiple" } },
    Title: {
      component: Noop,
      props: z.object({
        text: z.string(),
        size: z.enum(["sm", "md", "lg", "xl"]).optional(),
      }),
    },
    Text: { component: Noop, props: z.object({ text: z.string() }) },
    Button: {
      component: Noop,
      props: z.object({ label: z.string() }),
      events: { onClick: { parameters: z.object({}) } },
    },
    Tabs: {
      component: Noop,
      props: z.object({
        tabs: z.array(z.object({ title: z.string(), child: child() })),
      }),
    },
    Modal: {
      component: Noop,
      props: z.object({ title: z.string().optional() }),
      slots: { trigger: "single", content: "single" },
    },
    List: {
      component: Noop,
      props: z.object({
        items: z.array(z.string()).optional(),
        direction: z.enum(["vertical", "horizontal"]).optional(),
      }),
    },
    Card: {
      component: Noop,
      slots: { child: "single", children: "multiple" },
    },
  },
});

const create = (surfaceId: string) => ({
  version: "v1.0",
  createSurface: { surfaceId, catalogId: "app" },
});
const components = (surfaceId: string, ...nodes: object[]) => ({
  version: "v1.0",
  updateComponents: { surfaceId, components: nodes },
});
const data = (surfaceId: string, value: object) => ({
  version: "v1.0",
  updateDataModel: { surfaceId, path: "/", value },
});
const button = (id: string, label: string) => ({
  id,
  component: "Button",
  label,
});
/** A createSurface that carries its data model and components. */
const inlineCreate = (
  surfaceId: string,
  dataModel: object,
  ...nodes: object[]
) => ({
  version: "v1.0",
  createSurface: { surfaceId, dataModel, components: nodes },
});
const callFunction = (functionCallId: string, sku: string) => ({
  version: "v1.0",
  callRendererFunction: {
    functionCallId,
    callFunction: { "@call": "addToCart", args: { sku } },
  },
});
/** A Column with a title, a button, a text and a button: prose and UI. */
const mixedStack = [
  {
    id: "root",
    component: "Column",
    children: ["title", "buy", "note", "more"],
  },
  { id: "title", component: "Title", text: "Plans" },
  button("buy", "Buy"),
  { id: "note", component: "Text", text: "Or see more." },
  button("more", "More"),
];

/** An a2ui fence with one operation per line. Leave `close` false to keep it open. */
function fence(
  operations: object[],
  options: { info?: string; close?: boolean } = {},
) {
  const { info = "", close = true } = options;
  const body = operations.map((op) => JSON.stringify(op)).join("\n");
  return `\`\`\`a2ui${info}\n${body}\n${close ? "```\n" : ""}`;
}

function assistant(id: string, content: string): Message {
  return { id, role: "assistant", content };
}

function build(messages: Message[], running = false) {
  return buildMarkdownSurfaces(messages, { ui, functions: {}, running });
}

function syncedSource() {
  const manager = new GenerativeUISurfaceManager(ui);
  const source = new MarkdownSurfaceSource(manager, ui);
  const sync = (threadId: string, messages: Message[], running = false) =>
    source.sync(threadId, "default", messages, { running });
  return { manager, source, sync };
}

describe("buildMarkdownSurfaces", () => {
  it("keeps the panels of Tabs, referenced through typed child ids, when the prose is lifted", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components(
          "s1",
          { id: "root", component: "Column", children: ["title", "tabs"] },
          { id: "title", component: "Title", text: "Plans" },
          {
            id: "tabs",
            component: "Tabs",
            tabs: [
              { title: "A", child: "pa" },
              { title: "B", child: "pb" },
            ],
          },
          button("pa", "Panel A"),
          button("pb", "Panel B"),
        ),
      ]),
    );

    const { surfaces, fences } = build([message]);

    expect(fences.get("m1:0")).toEqual([
      { kind: "markdown", markdown: "### Plans" },
      { kind: "surface", surfaceId: "s1" },
    ]);
    const kept = surfaces
      .find((s) => s.surfaceId === "s1")
      ?.operations.flatMap((op) =>
        "updateComponents" in op &&
        Array.isArray(op.updateComponents.components)
          ? op.updateComponents.components.map((c) => (c as { id: string }).id)
          : [],
      );
    expect(kept).toEqual(["root", "tabs", "pa", "pb"]);
  });

  it("keeps the trigger and content of a Modal, referenced through its slots, when the prose is lifted", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components(
          "s1",
          { id: "root", component: "Column", children: ["title", "modal"] },
          { id: "title", component: "Title", text: "Plans" },
          { id: "modal", component: "Modal", trigger: "t", content: "c" },
          button("t", "Open"),
          button("c", "Body"),
        ),
      ]),
    );

    const { surfaces } = build([message]);

    const kept = surfaces
      .find((s) => s.surfaceId === "s1")
      ?.operations.flatMap((op) =>
        "updateComponents" in op &&
        Array.isArray(op.updateComponents.components)
          ? op.updateComponents.components.map((c) => (c as { id: string }).id)
          : [],
      );
    expect(kept).toEqual(["root", "modal", "t", "c"]);
  });

  it("keeps both the child and the children of a Card when its prose is lifted", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components(
          "s1",
          {
            id: "root",
            component: "Card",
            child: "title",
            children: ["lst", "note"],
          },
          { id: "title", component: "Title", text: "Plans" },
          {
            id: "lst",
            component: "List",
            direction: "horizontal",
            items: ["One", "Two"],
          },
          { id: "note", component: "Text", text: "Or see more." },
        ),
      ]),
    );

    const { surfaces, fences } = build([message]);

    expect(fences.get("m1:0")).toEqual([
      { kind: "markdown", markdown: "### Plans" },
      { kind: "surface", surfaceId: "s1" },
      { kind: "markdown", markdown: "Or see more." },
    ]);
    const root = surfaces
      .find((s) => s.surfaceId === "s1")
      ?.operations.flatMap((op) =>
        "updateComponents" in op &&
        Array.isArray(op.updateComponents.components)
          ? op.updateComponents.components
          : [],
      )
      .find((c) => (c as { id: string }).id === "root") as Record<
      string,
      unknown
    >;
    expect(root.children).toEqual(["lst"]);
    expect(root).not.toHaveProperty("child");
  });

  it("keeps a List whose direction is bound as a surface", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components("s1", {
          id: "root",
          component: "List",
          direction: { "@path": "/direction" },
          items: ["One", "Two"],
        }),
      ]),
    );

    const { fences } = build([message]);

    expect(fences.get("m1:0")).toEqual([{ kind: "surface", surfaceId: "s1" }]);
  });

  it("keeps a horizontal List as a surface instead of lifting it to a markdown list", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components("s1", {
          id: "root",
          component: "List",
          direction: "horizontal",
          items: ["One", "Two"],
        }),
      ]),
    );

    const { fences } = build([message]);

    expect(fences.get("m1:0")).toEqual([{ kind: "surface", surfaceId: "s1" }]);
  });

  it("treats an inherited object property as an unknown component, not as a catalog entry", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components(
          "s1",
          { id: "root", component: "Column", children: ["title", "x"] },
          { id: "title", component: "Title", text: "Plans" },
          { id: "x", component: "constructor" },
        ),
      ]),
    );

    const { surfaces } = build([message]);

    const surface = surfaces.find((s) => s.surfaceId === "s1");
    expect(surface?.rejected.map((r) => r.reason)).toEqual([
      expect.stringContaining('unknown component "constructor"'),
    ]);
  });

  it("does not lift prose out of a surface whose child references are bound, because their ids are unknown", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components(
          "s1",
          { id: "root", component: "Column", children: ["title", "tabs"] },
          { id: "title", component: "Title", text: "Plans" },
          { id: "tabs", component: "Tabs", tabs: { "@path": "/tabs" } },
          button("pa", "Panel A"),
        ),
      ]),
    );

    const { surfaces, fences } = build([message]);

    expect(fences.get("m1:0")).toEqual([{ kind: "surface", surfaceId: "s1" }]);
    const kept = surfaces
      .find((s) => s.surfaceId === "s1")
      ?.operations.flatMap((op) =>
        "updateComponents" in op &&
        Array.isArray(op.updateComponents.components)
          ? op.updateComponents.components.map((c) => (c as { id: string }).id)
          : [],
      );
    expect(kept).toEqual(["root", "title", "tabs", "pa"]);
  });

  it("turns a fence into the content of a chat surface that the fence renders", () => {
    const message = assistant(
      "m1",
      `Here you go:\n${fence([create("s1"), components("s1", button("root", "Buy"))])}`,
    );

    const { surfaces, fences } = build([message]);

    expect(surfaces).toEqual([
      {
        surfaceId: "s1",
        target: "chat",
        catalogId: "app",
        status: "ready",
        rejected: [],
        operations: [create("s1"), components("s1", button("root", "Buy"))],
      },
    ]);
    expect(fences.get("m1:0")).toEqual([{ kind: "surface", surfaceId: "s1" }]);
  });

  it("sends a fence with target=<id> to that target and renders nothing in its place", () => {
    const message = assistant(
      "m1",
      fence([create("recs"), components("recs", button("root", "Buy"))], {
        info: " target=recommendations",
      }),
    );

    const { surfaces, fences } = build([message]);

    expect(surfaces.map((s) => [s.surfaceId, s.target])).toEqual([
      ["recs", "recommendations"],
    ]);
    expect(fences.size).toBe(0);
  });

  it("adds a later fence of the same reply for the same surfaceId to the first surface, and only the first fence renders it", () => {
    const message = assistant(
      "m1",
      `${fence([create("s1"), components("s1", button("root", "Buy"))])}Updated:\n${fence([components("s1", button("root", "Buy now"))])}`,
    );

    const { surfaces, fences } = build([message]);

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].operations).toEqual([
      create("s1"),
      components("s1", button("root", "Buy")),
      components("s1", button("root", "Buy now")),
    ]);
    expect([...fences.keys()]).toEqual(["m1:0"]);
  });

  it("gives a later reply that reuses the id of a chat surface a surface of its own", () => {
    const first = assistant(
      "m1",
      fence([create("s1"), components("s1", button("root", "Buy"))]),
    );
    const later = assistant(
      "m2",
      `Five more:\n${fence([create("s1"), components("s1", button("root", "Buy now"))])}`,
    );

    const { surfaces, fences } = build([first, later]);

    expect(surfaces.map((s) => s.surfaceId)).toEqual(["s1", "s1@m2"]);
    expect(surfaces[1].operations).toEqual([
      create("s1@m2"),
      components("s1@m2", button("root", "Buy now")),
    ]);
    expect([...fences.keys()]).toEqual(["m1:0", "m2:0"]);
    expect(fences.get("m2:0")).toEqual([
      { kind: "surface", surfaceId: "s1@m2" },
    ]);
  });

  it("updates a page target from a later reply", () => {
    const first = assistant(
      "m1",
      fence([create("panel"), components("panel", button("root", "Buy"))], {
        info: " target=side",
      }),
    );
    const later = assistant(
      "m2",
      fence([components("panel", button("root", "Buy now"))], {
        info: " target=side",
      }),
    );

    const { surfaces } = build([first, later]);

    expect(surfaces.map((s) => s.surfaceId)).toEqual(["panel"]);
    expect(surfaces[0].target).toBe("side");
    expect(surfaces[0].operations).toHaveLength(3);
  });

  it.each([
    ["no catalogId", { surfaceId: "s1" }],
    ["another catalogId", { surfaceId: "s1", catalogId: "old/catalog@1" }],
  ])(
    "gives a createSurface with %s the catalog id of the generative UI",
    (_name, createSurface) => {
      const message = assistant(
        "m1",
        fence([
          { version: "v1.0", createSurface },
          components("s1", button("root", "Buy")),
        ]),
      );

      const [surface] = build([message]).surfaces;

      expect(surface.rejected).toEqual([]);
      expect(surface.operations[0]).toEqual(create("s1"));
    },
  );

  it("leaves out an invalid operation and lists it in rejected", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components("s1", { id: "root", component: "Missing" }),
        components("s1", button("root", "Buy")),
      ]),
    );

    const [surface] = build([message]).surfaces;

    expect(surface.operations).toEqual([
      create("s1"),
      components("s1", button("root", "Buy")),
    ]);
    expect(surface.rejected).toEqual([
      { index: 1, reason: 'component "root": unknown component "Missing"' },
    ]);
  });

  it("renders the complete components of a line that is still streaming", () => {
    const complete = fence([create("s1")], { close: false });
    // The first component is complete, but the operation is not.
    const halfLine =
      '{"version":"v1.0","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Button","label":"Buy"},{"id":"mo';
    const message = assistant("m1", `${complete}${halfLine}`);

    const [surface] = build([message], true).surfaces;

    expect(surface.status).toBe("streaming");
    expect(surface.operations).toEqual([
      create("s1"),
      components("s1", button("root", "Buy")),
    ]);
  });

  it("splits updateComponents into one operation per component", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        components("s1", button("root", "Buy"), button("more", "More")),
      ]),
    );

    const [surface] = build([message]).surfaces;

    expect(surface.operations).toEqual([
      create("s1"),
      components("s1", button("root", "Buy")),
      components("s1", button("more", "More")),
    ]);
  });

  it("only adds operations at the end while a fence streams in", () => {
    const text = fence([
      create("s1"),
      data("s1", { plan: "team" }),
      components(
        "s1",
        { id: "root", component: "Column", children: ["buy", "more"] },
        button("buy", "Buy"),
        button("more", "More"),
      ),
    ]);
    const steps: string[][] = [];
    for (let end = 1; end <= text.length; end++) {
      const closed = end === text.length;
      const [surface] = build(
        [assistant("m1", text.slice(0, end))],
        !closed,
      ).surfaces;
      if (surface)
        steps.push(surface.operations.map((op) => JSON.stringify(op)));
    }

    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].slice(0, steps[i - 1].length)).toEqual(steps[i - 1]);
    }
    expect(steps.at(-1)).toHaveLength(5);
  });

  it.each([
    [
      "separate operations",
      [
        create("s1"),
        data("s1", { plan: "team" }),
        components("s1", ...mixedStack),
      ],
    ],
    [
      "one inline createSurface",
      [inlineCreate("s1", { plan: "team" }, ...mixedStack)],
    ],
  ])(
    "lifts prose out of a chat surface made with %s and splits the rest into #n sub-surfaces",
    (_name, operations) => {
      const message = assistant("m1", fence(operations));

      const { surfaces, fences } = build([message]);

      expect(fences.get("m1:0")).toEqual([
        { kind: "markdown", markdown: "### Plans" },
        { kind: "surface", surfaceId: "s1" },
        { kind: "markdown", markdown: "Or see more." },
        { kind: "surface", surfaceId: "s1#1" },
      ]);
      expect(surfaces.find((s) => s.surfaceId === "s1#1")?.operations).toEqual([
        create("s1#1"),
        data("s1#1", { plan: "team" }),
        components("s1#1", {
          id: "root",
          component: "Column",
          children: ["more"],
        }),
        components("s1#1", button("more", "More")),
      ]);
    },
  );

  it("lifts the prose of an inline createSurface while it streams", () => {
    const text = fence([inlineCreate("s1", { plan: "team" }, ...mixedStack)]);
    const cut = text.indexOf('{"id":"note"');

    const { surfaces, fences } = build(
      [assistant("m1", text.slice(0, cut))],
      true,
    );

    expect(fences.get("m1:0")).toEqual([
      { kind: "markdown", markdown: "### Plans" },
      { kind: "surface", surfaceId: "s1" },
    ]);
    expect(surfaces.map((s) => [s.surfaceId, s.status])).toEqual([
      ["s1", "streaming"],
    ]);
  });

  it("only adds operations at the end while an inline createSurface streams in", () => {
    const text = fence([
      inlineCreate(
        "s1",
        { plan: "team" },
        { id: "root", component: "Column", children: ["buy", "more"] },
        button("buy", "Buy"),
        button("more", "More"),
      ),
    ]);
    const steps: string[][] = [];
    for (let end = 1; end <= text.length; end++) {
      const closed = end === text.length;
      const [surface] = build(
        [assistant("m1", text.slice(0, end))],
        !closed,
      ).surfaces;
      if (surface)
        steps.push(surface.operations.map((op) => JSON.stringify(op)));
    }

    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].slice(0, steps[i - 1].length)).toEqual(steps[i - 1]);
    }
    expect(steps.at(-1)?.map((op) => JSON.parse(op))).toEqual([
      create("s1"),
      data("s1", { plan: "team" }),
      components("s1", {
        id: "root",
        component: "Column",
        children: ["buy", "more"],
      }),
      components("s1", button("buy", "Buy")),
      components("s1", button("more", "More")),
    ]);
  });

  it("gives the function call lines in order and keeps them out of the surfaces", () => {
    const first = assistant(
      "m1",
      fence([
        create("s1"),
        callFunction("f1", "a"),
        components("s1", button("root", "Buy")),
      ]),
    );
    const onlyCall = assistant(
      "m2",
      `Adding it.\n${fence([callFunction("f2", "b")])}`,
    );

    const { surfaces, fences, functionCalls } = build([first, onlyCall]);

    expect(functionCalls).toEqual([
      { messageId: "m1", fenceIndex: 0, operation: callFunction("f1", "a") },
      { messageId: "m2", fenceIndex: 0, operation: callFunction("f2", "b") },
    ]);
    expect(surfaces.map((s) => [s.surfaceId, s.operations])).toEqual([
      ["s1", [create("s1"), components("s1", button("root", "Buy"))]],
    ]);
    expect([...fences.keys()]).toEqual(["m1:0"]);
  });
});

describe("MarkdownSurfaceSource", () => {
  it("keeps the same surface when a later sync only adds operations", () => {
    const { manager, sync } = syncedSource();
    const created = assistant("m1", fence([create("s1")], { close: false }));
    sync("t1", [created], true);
    const before = manager.getSurface("t1", "s1");

    const grown = assistant(
      "m1",
      fence([create("s1"), components("s1", button("root", "Buy"))]),
    );
    sync("t1", [grown]);

    const after = manager.getSurface("t1", "s1");
    expect(after).toBe(before);
    expect(after?.model.componentsModel.get("root")?.properties).toEqual({
      label: "Buy",
    });
  });

  it("shows each component as it streams in, on the same surface", () => {
    const { manager, sync } = syncedSource();
    const text = fence([
      create("s1"),
      components(
        "s1",
        { id: "root", component: "Column", children: ["buy", "more"] },
        button("buy", "Buy"),
        button("more", "More"),
      ),
    ]);
    const cut = text.indexOf('{"id":"more"');
    sync("t1", [assistant("m1", text.slice(0, cut))], true);
    const streaming = manager.getSurface("t1", "s1");

    expect(streaming?.model.componentsModel.get("buy")).toBeDefined();
    expect(streaming?.model.componentsModel.get("more")).toBeUndefined();

    sync("t1", [assistant("m1", text)]);

    const done = manager.getSurface("t1", "s1");
    expect(done).toBe(streaming);
    expect(done?.model.componentsModel.get("more")?.properties).toEqual({
      label: "More",
    });
  });

  it("gives the rejections to the surface in the manager", () => {
    const { manager, sync } = syncedSource();
    sync("t1", [
      assistant(
        "m1",
        fence([
          create("s1"),
          components("s1", { id: "root", component: "Missing" }),
        ]),
      ),
    ]);

    expect(manager.getSurface("t1", "s1")?.serverRejected).toEqual([
      { index: 1, reason: 'component "root": unknown component "Missing"' },
    ]);
  });

  it("builds a new thread from its own messages only", () => {
    const { manager, source, sync } = syncedSource();
    const threadA = [
      assistant(
        "a1",
        fence([create("old"), components("old", button("root", "A"))]),
      ),
    ];
    const threadB = [
      assistant(
        "b1",
        fence([create("new"), components("new", button("root", "B"))]),
      ),
    ];
    sync("A", threadA);
    // The thread id changes before the messages of the new thread arrive.
    sync("B", threadA);

    sync("B", threadB);

    expect(manager.getSurface("B", "old")).toBeUndefined();
    expect(manager.getSurface("B", "new")).toBeDefined();
    expect(source.getFenceBlocks("B", "a1", 0)).toBeUndefined();
    expect(source.getFenceBlocks("B", "b1", 0)).toEqual([
      { kind: "surface", surfaceId: "new" },
    ]);
  });
});
