import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Message } from "@ag-ui/client";
import { createGenerativeUI } from "../catalog";
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
  },
});

const create = (surfaceId: string) => ({
  version: "v0.9",
  createSurface: { surfaceId, catalogId: "app" },
});
const components = (surfaceId: string, ...nodes: object[]) => ({
  version: "v0.9",
  updateComponents: { surfaceId, components: nodes },
});
const data = (surfaceId: string, value: object) => ({
  version: "v0.9",
  updateDataModel: { surfaceId, path: "/", value },
});
const button = (id: string, label: string) => ({
  id,
  component: "Button",
  label,
});

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

  it("adds a later fence for the same surfaceId to the first surface, and only the first fence renders it", () => {
    const first = assistant(
      "m1",
      fence([create("s1"), components("s1", button("root", "Buy"))]),
    );
    const later = assistant(
      "m2",
      `Updated:\n${fence([components("s1", button("root", "Buy now"))])}`,
    );

    const { surfaces, fences } = build([first, later]);

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].operations).toEqual([
      create("s1"),
      components("s1", button("root", "Buy")),
      components("s1", button("root", "Buy now")),
    ]);
    expect([...fences.keys()]).toEqual(["m1:0"]);
  });

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

  it("uses only the complete operations of a fence that is still streaming", () => {
    const complete = fence([create("s1")], { close: false });
    // The first component is complete, but the operation is not.
    const halfLine =
      '{"version":"v0.9","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Button","label":"Buy"},{"id":"mo';
    const message = assistant("m1", `${complete}${halfLine}`);

    const [surface] = build([message], true).surfaces;

    expect(surface.status).toBe("streaming");
    expect(surface.operations).toEqual([create("s1")]);
  });

  it("lifts prose out of a chat surface and splits the rest into #n sub-surfaces", () => {
    const message = assistant(
      "m1",
      fence([
        create("s1"),
        data("s1", { plan: "team" }),
        components(
          "s1",
          {
            id: "root",
            component: "Column",
            children: ["title", "buy", "note", "more"],
          },
          { id: "title", component: "Title", text: "Plans" },
          button("buy", "Buy"),
          { id: "note", component: "Text", text: "Or see more." },
          button("more", "More"),
        ),
      ]),
    );

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
      components(
        "s1#1",
        { id: "root", component: "Column", children: ["more"] },
        button("more", "More"),
      ),
    ]);
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
