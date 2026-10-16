import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Message } from "@ag-ui/client";
import type { A2UIOperation } from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import {
  buildMarkdownSurfaces,
  MarkdownSurfaceSource,
} from "../markdown/source";
import { GenerativeUISurfaceManager, surfaceKey } from "../surface-manager";

/**
 * The parts of a chat surface that the prose lift split share one data
 * model: a user write to one part reaches every part, so a Slider in one
 * part drives a Text in another.
 */

const Noop = () => null;
const ui = createGenerativeUI({
  id: "app",
  components: {
    Column: { component: Noop, slots: { children: "multiple" } },
    Card: {
      component: Noop,
      props: z.object({ variant: z.string().optional() }),
      slots: { children: "multiple" },
    },
    Title: { component: Noop, props: z.object({ text: z.string() }) },
    Text: { component: Noop, props: z.object({ text: z.string() }) },
    Slider: {
      component: Noop,
      props: z.object({ value: z.number().optional() }),
      writable: ["value"] as const,
    },
  },
});

const T = "thread";

const op = (payload: Record<string, unknown>): A2UIOperation =>
  ({ version: "v0.9", ...payload }) as A2UIOperation;

function content(surfaceId: string, operations: A2UIOperation[]) {
  return {
    surfaceId,
    target: "chat",
    catalogId: "app",
    operations,
    status: "ready" as const,
    rejected: [],
  };
}

describe("GenerativeUISurfaceManager.linkSurfaces", () => {
  function twoParts() {
    const manager = new GenerativeUISurfaceManager(ui);
    for (const id of ["s", "s#1"]) {
      manager.ingest(
        T,
        "default",
        content(id, [
          op({ createSurface: { surfaceId: id, catalogId: "app" } }),
          op({
            updateDataModel: { surfaceId: id, path: "/", value: { seats: 1 } },
          }),
        ]),
      );
    }
    manager.linkSurfaces(T, ["s", "s#1"]);
    return manager;
  }

  it("writes a user value to every linked surface and marks it owned in each", () => {
    const manager = twoParts();
    manager.setOwnedValue(surfaceKey(T, "s"), "/seats", 12);
    expect(manager.getSurface(T, "s")!.model.dataModel.get("/seats")).toBe(12);
    expect(manager.getSurface(T, "s#1")!.model.dataModel.get("/seats")).toBe(
      12,
    );
    expect(manager.describeSurfaces(T)).toEqual({
      s: { target: "chat", dataModel: { "/seats": 12 } },
      "s#1": { target: "chat", dataModel: { "/seats": 12 } },
    });
  });

  it("keeps the user value in every part when the agent writes the path later", () => {
    const manager = twoParts();
    manager.setOwnedValue(surfaceKey(T, "s"), "/seats", 12);
    manager.ingest(
      T,
      "default",
      content("s#1", [
        op({ createSurface: { surfaceId: "s#1", catalogId: "app" } }),
        op({
          updateDataModel: { surfaceId: "s#1", path: "/", value: { seats: 1 } },
        }),
        op({ updateDataModel: { surfaceId: "s#1", path: "/seats", value: 3 } }),
      ]),
    );
    expect(manager.getSurface(T, "s#1")!.model.dataModel.get("/seats")).toBe(
      12,
    );
  });

  it("a later link of one surface alone clears its group", () => {
    const manager = twoParts();
    manager.linkSurfaces(T, ["s"]);
    manager.setOwnedValue(surfaceKey(T, "s"), "/seats", 7);
    expect(manager.getSurface(T, "s#1")!.model.dataModel.get("/seats")).toBe(1);
    expect(manager.getLinkedSurfaceIds(T, "s")).toEqual(["s"]);
  });
});

describe("markdown transport: the parts of a split surface", () => {
  const fence = (operations: object[]) =>
    `\`\`\`a2ui\n${operations.map((o) => JSON.stringify(o)).join("\n")}\n\`\`\`\n`;
  const message: Message = {
    id: "m1",
    role: "assistant",
    content: fence([
      {
        version: "v0.9",
        createSurface: { surfaceId: "plan", catalogId: "app" },
      },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "plan", path: "/", value: { seats: 5 } },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "plan",
          components: [
            {
              id: "root",
              component: "Column",
              children: ["seats", "intro", "price"],
            },
            { id: "seats", component: "Slider", value: { path: "/seats" } },
            { id: "intro", component: "Title", text: "Your plan" },
            { id: "price", component: "Text", text: { path: "/seats" } },
          ],
        },
      },
    ]),
  };

  it("lists the parts of each surface", () => {
    const { parts, surfaces } = buildMarkdownSurfaces([message], {
      ui,
      functions: {},
      running: false,
    });
    expect(parts.get("plan")).toEqual(["plan", "plan#1"]);
    expect(surfaces.map((s) => s.surfaceId)).toEqual(["plan", "plan#1"]);
  });

  it("links the parts in the manager, so a user write in one part shows in the other", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    const source = new MarkdownSurfaceSource(manager, ui);
    source.sync(T, "default", [message], { running: false });
    expect(manager.getLinkedSurfaceIds(T, "plan").sort()).toEqual([
      "plan",
      "plan#1",
    ]);
    manager.setOwnedValue(surfaceKey(T, "plan"), "/seats", 20);
    expect(manager.getSurface(T, "plan#1")!.model.dataModel.get("/seats")).toBe(
      20,
    );
  });
});
