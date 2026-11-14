import React, { useEffect } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import type { AnyComponent } from "@a2ui/web_core/v0_9";
import { createCatalog } from "../create-catalog";
import { A2UIProvider, useA2UIActions } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";

// A list template resolves to `{ id, basePath }` items; the template child's
// relative bindings only resolve if the renderer forwards `basePath`.
type ChildNode = { id: string; basePath?: string };

const definitions = {
  PartList: { props: z.object({ items: CommonSchemas.ChildList }) },
  PartRow: { props: z.object({ name: CommonSchemas.DynamicString }) },
};

const catalog = createCatalog(definitions, {
  PartList: ({ props, children }) => (
    <ul>
      {(props.items as unknown as ChildNode[]).map((node, i) => (
        <li key={`${node.id}-${i}`}>{children(node.id, node.basePath)}</li>
      ))}
    </ul>
  ),
  PartRow: ({ props }) => <span>{String(props.name ?? "")}</span>,
});

const components: AnyComponent[] = [
  {
    id: "root",
    component: "PartList",
    items: { componentId: "row", path: "/parts" },
  },
  { id: "row", component: "PartRow", name: { path: "name" } },
];

function Surface() {
  const { processMessages } = useA2UIActions();
  useEffect(() => {
    processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "parts", catalogId: catalog.id },
      },
      { version: "v0.9", updateComponents: { surfaceId: "parts", components } },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "parts",
          path: "/",
          value: { parts: [{ name: "Bolt A" }, { name: "Bolt B" }] },
        },
      },
    ]);
  }, [processMessages]);
  return <A2UIRenderer surfaceId="parts" />;
}

describe("custom renderer children", () => {
  it("resolves relative bindings in a list template when basePath is forwarded", async () => {
    render(
      <A2UIProvider catalog={catalog}>
        <Surface />
      </A2UIProvider>,
    );
    await act(async () => {});
    expect(screen.getByText("Bolt A")).toBeTruthy();
    expect(screen.getByText("Bolt B")).toBeTruthy();
  });
});
