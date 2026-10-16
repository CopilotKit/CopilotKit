import { describe, expect, it } from "vitest";
import { readCopilotKitUIEnvelope } from "../a2ui-envelope";
import type { CopilotKitUIEnvelope } from "../a2ui-envelope";

function createEnvelope(
  overrides?: Partial<CopilotKitUIEnvelope>,
): CopilotKitUIEnvelope {
  return {
    method: "a2ui",
    version: "v0.9",
    format: 2,
    transport: "markdown",
    catalog: {
      id: "acme/app",
      version: "1",
      components: {
        ProductGrid: {
          description: "A grid of products.",
          props: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
          },
          events: { onSelect: { parameters: { type: "object" } } },
          slots: { children: "multiple" },
        },
      },
    },
    functions: {
      addToCart: { description: "Add.", parameters: { type: "object" } },
    },
    targets: [
      { id: "chat", kind: "chat" },
      { id: "sidebar", kind: "inline", description: "Right column." },
    ],
    surfaces: {
      cart: { target: "sidebar" },
      form: {
        target: "chat",
        dataModel: { "/form/email": "me@x.io" },
        rejected: ["operation 2: unknown component Foo"],
      },
    },
    instructions: "Write fences.",
    contextSent: true,
    ...overrides,
  };
}

/** Reads `ui` from `forwardedProps.copilotkit.ui`. */
const readUI = (ui: unknown) =>
  readCopilotKitUIEnvelope({ copilotkit: { ui }, other: 1 });

/** An envelope with one top-level field replaced by any value. */
const withField = (key: string, value: unknown) => ({
  ...createEnvelope(),
  [key]: value,
});

describe("readCopilotKitUIEnvelope", () => {
  it("reads a markdown envelope from forwardedProps.copilotkit.ui", () => {
    const envelope = createEnvelope();
    expect(readUI(envelope)).toEqual(envelope);
  });

  it("reads a tool envelope without instructions and without components", () => {
    const envelope: CopilotKitUIEnvelope = {
      method: "a2ui",
      version: "v0.9",
      format: 2,
      transport: "tool",
      catalog: { id: "acme/app", version: "1" },
      functions: {},
      targets: [],
      surfaces: {},
      contextSent: false,
    };
    expect(readUI(envelope)).toEqual(envelope);
  });

  it("reads a surface with 20 rejections of 500 characters", () => {
    const envelope = createEnvelope({
      surfaces: {
        cart: { target: "chat", rejected: Array(20).fill("x".repeat(500)) },
      },
    });
    expect(readUI(envelope)).toEqual(envelope);
  });

  it("returns undefined when there is no envelope", () => {
    expect(readCopilotKitUIEnvelope(undefined)).toBeUndefined();
    expect(readCopilotKitUIEnvelope("copilotkit")).toBeUndefined();
    expect(readCopilotKitUIEnvelope({})).toBeUndefined();
    expect(readCopilotKitUIEnvelope({ copilotkit: null })).toBeUndefined();
    expect(readCopilotKitUIEnvelope({ copilotkit: {} })).toBeUndefined();
  });

  it.each([
    ["a wrong method", withField("method", "html")],
    ["a wrong version", withField("version", "v1.0")],
    ["the format 1 envelope", withField("format", 1)],
    ["an unknown transport", withField("transport", "fence")],
    ["no catalog", withField("catalog", undefined)],
    ["no catalog id", withField("catalog", { version: "1" })],
    ["an empty catalog id", withField("catalog", { id: "", version: "1" })],
    ["no catalog version", withField("catalog", { id: "acme/app" })],
    [
      "a component without a props schema",
      withField("catalog", {
        id: "acme/app",
        version: "1",
        components: { Card: { description: "x" } },
      }),
    ],
    [
      "a component whose required list is not strings",
      withField("catalog", {
        id: "acme/app",
        version: "1",
        components: { Card: { props: { type: "object", required: 5 } } },
      }),
    ],
    [
      "an unknown slot kind",
      withField("catalog", {
        id: "acme/app",
        version: "1",
        components: { Card: { props: {}, slots: { body: "many" } } },
      }),
    ],
    [
      "an event without parameters",
      withField("catalog", {
        id: "acme/app",
        version: "1",
        components: { Card: { props: {}, events: { onClick: {} } } },
      }),
    ],
    ["a function without parameters", withField("functions", { add: {} })],
    ["targets that are not a list", withField("targets", { chat: "chat" })],
    [
      "a target with an unknown kind",
      withField("targets", [{ id: "x", kind: "modal" }]),
    ],
    ["a surface without a target", withField("surfaces", { cart: {} })],
    [
      "a surface data model that is not an object",
      withField("surfaces", { cart: { target: "chat", dataModel: ["a"] } }),
    ],
    [
      "surface rejections that are not strings",
      withField("surfaces", { cart: { target: "chat", rejected: [1] } }),
    ],
    [
      "more than 20 surface rejections",
      withField("surfaces", {
        cart: { target: "chat", rejected: Array(21).fill("operation 0: x") },
      }),
    ],
    [
      "a surface rejection longer than 500 characters",
      withField("surfaces", {
        cart: { target: "chat", rejected: ["x".repeat(501)] },
      }),
    ],
    ["instructions that are not text", withField("instructions", ["a"])],
    ["no contextSent flag", withField("contextSent", undefined)],
  ])("returns undefined for %s", (_case, ui) => {
    expect(readUI(ui)).toBeUndefined();
  });
});
