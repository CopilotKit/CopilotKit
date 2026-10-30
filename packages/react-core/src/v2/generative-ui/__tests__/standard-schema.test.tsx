// Schemas that are not zod: a small hand-written Standard Schema, with a
// Standard JSON Schema, stands in for Valibot or ArkType.
import React from "react";
import { render as renderDom } from "@testing-library/react";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  A2UIComponentNode,
  GenerativeUISurfaceContent,
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUIComponentProps } from "../catalog";
import { createGenerativeUIDispatcher } from "@copilotkit/core/generative-ui";
import { GenerativeUIRuntimeContext } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import { SurfaceView } from "../SurfaceView";

type Kind = "string" | "number";
type Value<K extends Kind> = K extends "string" ? string : number;
type Shape = Record<string, Kind>;
type Out<S extends Shape> = { [Key in keyof S]: Value<S[Key]> };

/** An object of required string and number fields, with no zod. */
function object<S extends Shape>(
  shape: S,
  { async = false }: { async?: boolean } = {},
): StandardSchemaV1<Out<S>, Out<S>> & StandardJSONSchemaV1<Out<S>, Out<S>> {
  const validate = (value: unknown): StandardSchemaV1.Result<Out<S>> => {
    if (typeof value !== "object" || value === null) {
      return { issues: [{ message: "expected an object" }] };
    }
    const record = value as Record<string, unknown>;
    const issues = Object.entries(shape)
      .filter(([key, kind]) => typeof record[key] !== kind)
      .map(([key, kind]) => ({ message: `expected a ${kind}`, path: [key] }));
    if (issues.length > 0) return { issues };
    const out = Object.fromEntries(
      Object.keys(shape).map((key) => [key, record[key]]),
    );
    return { value: out as Out<S> };
  };
  const json = () => ({
    type: "object",
    properties: Object.fromEntries(
      Object.entries(shape).map(([key, kind]) => [key, { type: kind }]),
    ),
    required: Object.keys(shape),
  });
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: async ? (value) => Promise.resolve(validate(value)) : validate,
      jsonSchema: { input: json, output: json },
    },
  };
}

function Tag({
  label,
  count,
  stock,
}: GenerativeUIComponentProps<typeof ui, "Tag">) {
  return (
    <span>
      {label}:{count}:{stock}
    </span>
  );
}

const ui = createGenerativeUI({
  id: "plain",
  state: { stock: object({ left: "number" }) },
  components: {
    Tag: {
      component: Tag,
      props: object({ label: "string", count: "number", stock: "number" }),
      bind: { stock: (state) => state.stock.left },
    },
    Slow: {
      component: () => null,
      props: object({ label: "string" }, { async: true }),
    },
  },
});

function setup() {
  const manager = new GenerativeUISurfaceManager(ui);
  manager.setActiveThread("t1");
  manager.setState("stock", { left: 4 });
  const runtime: GenerativeUIRuntime = {
    manager,
    ui,
    transport: "tool",
    config: { ui },
    reportError: () => {},
    forwardEvent: async () => ({ ok: true as const, result: undefined }),
    errorFallback: undefined,
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
  const ingest = (root: A2UIComponentNode) => {
    const content: GenerativeUISurfaceContent = {
      surfaceId: "s1",
      target: "inline",
      catalogId: "plain",
      operations: [
        {
          version: "v1.0",
          createSurface: { surfaceId: "s1", catalogId: "plain" },
        },
        {
          version: "v1.0",
          updateComponents: { surfaceId: "s1", components: [root] },
        },
      ],
      status: "ready",
      rejected: [],
    };
    manager.ingest("t1", "default", content);
    return manager.getSurface("t1", "s1")!;
  };
  const render = () =>
    renderDom(
      <GenerativeUIRuntimeContext.Provider value={runtime}>
        <SurfaceView surface={manager.getSurface("t1", "s1")!} />
      </GenerativeUIRuntimeContext.Provider>,
    ).container.textContent;
  return { ingest, render };
}

describe("generative UI with a schema that is not zod", () => {
  it("types the component props from the schema output", () => {
    expectTypeOf<GenerativeUIComponentProps<typeof ui, "Tag">>().toEqualTypeOf<{
      label: string;
      count: number;
      stock: number;
    }>();
  });

  it("sends the model the JSON Schema without the bound props", () => {
    expect(ui.manifestComponents.Tag?.props).toEqual({
      type: "object",
      properties: { label: { type: "string" }, count: { type: "number" } },
      required: ["label", "count"],
      additionalProperties: false,
    });
  });

  it("renders a node with the parsed props and the bound value", () => {
    const { ingest, render } = setup();
    const surface = ingest({
      id: "root",
      component: "Tag",
      label: "Mug",
      count: 2,
    });
    expect(surface.clientRejected).toEqual([]);
    expect(render()).toBe("Mug:2:4");
  });

  it("rejects a literal prop of the wrong type with the schema issue", () => {
    const { ingest } = setup();
    const surface = ingest({
      id: "root",
      component: "Tag",
      label: "Mug",
      count: "two",
    });
    expect(surface.clientRejected).toHaveLength(1);
    expect(surface.clientRejected[0]!.reason).toContain(
      "count: expected a number",
    );
  });

  it("leaves a bound path value to the render check", () => {
    const { ingest } = setup();
    const surface = ingest({
      id: "root",
      component: "Tag",
      label: "Mug",
      count: { "@path": "/count" },
    });
    expect(surface.clientRejected).toEqual([]);
  });

  it("rejects a schema that validates asynchronously", () => {
    const { ingest } = setup();
    const surface = ingest({ id: "root", component: "Slow", label: "x" });
    expect(surface.clientRejected[0]?.reason).toContain(
      "validates asynchronously",
    );
  });
});
