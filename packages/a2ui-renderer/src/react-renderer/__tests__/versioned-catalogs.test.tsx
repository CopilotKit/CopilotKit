import React, { useEffect } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import {
  ActionSchema,
  ChildListSchema,
  DynamicStringSchema,
  ComponentDefinitionSchema,
  FunctionDefinitionSchema,
} from "@a2ui/web_core/v1_0";
import { createCatalog } from "../create-catalog";
import type { CatalogRenderers } from "../create-catalog";
import { filterCatalog } from "../../filter-catalog";
import { basicCatalog, basicCatalogV1 } from "../a2ui-react";
import {
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "../catalog-utils";
import type { InlineCatalogSchema } from "../catalog-utils";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
} from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import * as packageEntry from "../../index";

const definitions = {
  Editor: {
    props: z.object({ name: DynamicStringSchema, save: ActionSchema }),
  },
  Parts: { props: z.object({ items: ChildListSchema }) },
};
const renderers: CatalogRenderers<typeof definitions> = {
  Editor: ({ props }) => (
    <input
      aria-label="Edit name"
      value={props.name ?? ""}
      onChange={(event) => {
        props.setName(event.target.value);
        props.save();
      }}
    />
  ),
  Parts: ({ props, children }) => (
    <ul>
      {(props.items as unknown as { id: string; basePath: string }[]).map(
        (item, i) => (
          <li key={i}>{children(item.id, item.basePath)}</li>
        ),
      )}
    </ul>
  ),
};
function makeCatalog() {
  return createCatalog(definitions, renderers, {
    catalogId: "acme://native",
    protocolVersion: "1.0",
    includeBasicCatalog: true,
  });
}
/**
 * Process initial messages with the selected catalog and expose both surface
 * hosts, provider actions, and dispatched events for catalog-isolation checks.
 */
function mount(catalog: Catalog<any>, messages: Record<string, unknown>[]) {
  let actions!: ReturnType<typeof useA2UIActions>;
  const onAction = vi.fn();
  function Surface() {
    actions = useA2UIActions();
    const error = useA2UIError();
    useEffect(() => actions.processMessages(messages), []);
    return (
      <>
        {error && <div role="alert">{error}</div>}
        <A2UIRenderer surfaceId="native" />
        <A2UIRenderer surfaceId="legacy" />
      </>
    );
  }
  return {
    ...render(
      <A2UIProvider catalog={catalog} onAction={onAction}>
        <Surface />
      </A2UIProvider>,
    ),
    actions,
    onAction,
  };
}
function nativeMessages(catalogId: string): Record<string, unknown>[] {
  return [
    {
      version: "1.0",
      createSurface: {
        surfaceId: "native",
        catalogId,
        components: [
          { id: "root", component: "Column", children: ["editor", "parts"] },
          {
            id: "editor",
            component: "Editor",
            name: { "@path": "/name" },
            save: {
              event: { name: "save", context: { name: { "@path": "/name" } } },
            },
          },
          {
            id: "parts",
            component: "Parts",
            items: { componentId: "part", path: "/parts" },
          },
          { id: "part", component: "Text", text: { "@path": "name" } },
        ],
        dataModel: {
          name: "Ada",
          parts: [{ name: "Bolt A" }, { name: "Bolt B" }],
        },
      },
    },
  ];
}

describe("versioned custom catalogs", () => {
  it("validates basic native themes on raw create-surface operations", () => {
    const catalog = makeCatalog();
    const processor = new MessageProcessor([catalog]);

    expect(() =>
      processor.processMessages({
        type: "createSurface",
        version: "1.0",
        surfaceId: "invalid-theme",
        catalogId: catalog.id,
        theme: { primaryColor: "not-a-color" },
      }),
    ).toThrow(/primaryColor/);
    expect(processor.model.getSurface("invalid-theme")).toBeUndefined();

    processor.processMessages({
      type: "createSurface",
      version: "1.0",
      surfaceId: "valid-theme",
      catalogId: catalog.id,
      theme: { primaryColor: "#00BFFF" },
    });
    expect(processor.model.getSurface("valid-theme")?.theme).toEqual({
      primaryColor: "#00BFFF",
    });
  });

  it.each([
    { protocolVersion: "v0.9", includeBasicCatalog: true },
    { protocolVersion: "v0.9", includeBasicCatalog: false },
    { protocolVersion: "1.0", includeBasicCatalog: false },
  ] as const)(
    "keeps theme validation unchanged for $protocolVersion with includeBasicCatalog=$includeBasicCatalog",
    (options) => {
      const catalog = createCatalog({}, {}, options);
      const processor = new MessageProcessor([catalog]);
      expect(catalog.themeSchema).toBeUndefined();
      expect(() =>
        processor.processMessages({
          type: "createSurface",
          version: options.protocolVersion,
          surfaceId: "custom-theme",
          catalogId: catalog.id,
          theme: { primaryColor: "not-a-color" },
        }),
      ).not.toThrow();
    },
  );

  it("defaults createCatalog to v0.9 and opts into native 1.0 explicitly", () => {
    expect(createCatalog({}, {}).protocolVersion).toBe("0.9");
    expect(makeCatalog().protocolVersion).toBe("1.0");
    expect(makeCatalog().components.get("Text")?.schema).toBe(
      basicCatalogV1.components.get("Text")?.schema,
    );
    expect(makeCatalog().functions.get("formatNumber")).toBe(
      basicCatalogV1.functions.get("formatNumber"),
    );
  });

  it("binds native custom props, edits data, resolves relative child lists and forwards action context", async () => {
    const catalog = makeCatalog();
    const view = mount(catalog, nativeMessages(catalog.id));
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Bolt A")).toBeTruthy();
    expect(view.getByText("Bolt B")).toBeTruthy();
    fireEvent.change(view.getByLabelText("Edit name"), {
      target: { value: "Grace" },
    });
    await waitFor(() =>
      expect(view.onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userAction: expect.objectContaining({
            name: "save",
            context: { name: "Grace" },
          }),
        }),
      ),
    );
  });

  it("renders historical v0.9 basic surfaces alongside an opted-in native catalog", () => {
    const catalog = makeCatalog();
    const view = mount(catalog, [
      ...nativeMessages(catalog.id),
      {
        version: "v0.9",
        createSurface: { surfaceId: "legacy", catalogId: basicCatalog.id },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "legacy",
          components: [{ id: "root", component: "Text", text: "Old card" }],
        },
      },
    ]);
    expect(view.getByText("Old card")).toBeTruthy();
    expect(view.getByLabelText("Edit name")).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("preserves native action user messages, explicit catalog identity and metadata", async () => {
    const catalog = makeCatalog();
    const view = mount(catalog, nativeMessages(catalog.id));
    await act(async () => {
      await view.actions.getSurface("native").dispatchAction(
        {
          event: {
            name: "save",
            catalogId: catalog.id,
            userMessage: "Save my changes",
            context: { id: 42 },
          },
        },
        "editor",
        { extensions: { source: "test" } },
      );
    });
    expect(view.onAction).toHaveBeenCalledWith({
      userAction: expect.objectContaining({
        name: "save",
        catalogId: catalog.id,
        userMessage: "Save my changes",
        metadata: { extensions: { source: "test" } },
      }),
    });
  });

  it("does not let the same-version default catalog bypass component filtering", () => {
    const catalog = filterCatalog(makeCatalog(), (name) => name !== "Text");
    const view = mount(catalog, [
      {
        version: "1.0",
        createSurface: {
          surfaceId: "native",
          catalogId: basicCatalogV1.id,
          components: [
            { id: "root", component: "Text", text: "Should not render" },
          ],
        },
      },
    ]);
    expect(view.getByRole("alert").textContent).toMatch(/catalog not found/i);
    expect(view.queryByText("Should not render")).toBeNull();
  });

  it("exports bounded native schemas from the source package entry", () => {
    for (const name of [
      "DynamicStringSchemaV1",
      "DynamicNumberSchemaV1",
      "DynamicBooleanSchemaV1",
      "DynamicStringListSchemaV1",
      "DataBindingSchemaV1",
      "ChildListSchemaV1",
      "ActionSchemaV1",
      "CheckRuleSchemaV1",
    ]) {
      expect((packageEntry as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});

describe("native catalog advertisement", () => {
  it("accepts optional catalogs and explicit undefined without changing the legacy default", () => {
    const extractOptional = (catalog?: Catalog<ComponentApi>) =>
      extractCatalogComponentSchemas(catalog);
    const legacy: InlineCatalogSchema = extractCatalogComponentSchemas();

    expect(extractOptional()).toEqual(legacy);
    expect(extractCatalogComponentSchemas(undefined)).toEqual(legacy);
    expect(extractOptional(makeCatalog())).toHaveProperty(
      "protocolVersion",
      "1.0",
    );
  });

  it("exports a 1.0 document with native functions and resolvable component definitions", () => {
    const schema = extractCatalogComponentSchemas(makeCatalog());
    expect(schema).toMatchObject({
      protocolVersion: "1.0",
      catalogId: "acme://native",
    });
    expect(Array.isArray(schema.functions)).toBe(false);
    expect(schema).not.toHaveProperty("common_types.json");
    for (const component of Object.values(schema.components))
      expect(ComponentDefinitionSchema.safeParse(component).success).toBe(true);
    for (const fn of Object.values(schema.functions ?? {}))
      expect(FunctionDefinitionSchema.safeParse(fn).success).toBe(true);
    expect(Catalog.fromJson(schema).toJson()).toEqual(schema);
  });

  it("keeps version and document metadata when filtering and removes disabled component refs", () => {
    const catalog = new Catalog(
      "acme://document",
      "1.0",
      [...makeCatalog().components.values()],
      [...makeCatalog().functions.values()],
      {
        themeSchema: z.object({ primaryColor: z.string() }),
        schemaUri: "https://json-schema.org/draft/2020-12/schema",
        schemaId: "https://example.com/catalog.json",
        title: "Acme native components",
        description: "Custom design system",
        instructions: "Use Parts for repeated content",
        defs: { Token: { type: "string" } },
      },
    );
    const original = catalog.toJson();
    const filtered = filterCatalog(catalog, (name) => name !== "Editor");
    const schema = extractCatalogComponentSchemas(filtered);
    if (!("protocolVersion" in schema))
      throw new Error("Expected a native catalog document");
    expect(filtered.protocolVersion).toBe("1.0");
    expect(filtered.themeSchema).toBe(catalog.themeSchema);
    for (const key of [
      "$schema",
      "$id",
      "title",
      "description",
      "instructions",
      "functions",
    ])
      expect(schema[key]).toEqual(original[key]);
    expect(schema.components).not.toHaveProperty("Editor");
    expect(JSON.stringify(schema.$defs)).not.toContain("#/components/Editor");
    expect(schema.$defs).toHaveProperty("Token");
    expect(Catalog.fromJson(schema).components.has("Parts")).toBe(true);
  });

  it("uses native capability prose while retaining name-only opt-out", () => {
    const catalog = makeCatalog();
    const full = buildCatalogContextValue(catalog);
    expect(full).toContain('"protocolVersion": "1.0"');
    expect(full).toContain('"@call"');
    expect(full).toContain("common_types.json#/$defs/DynamicString");
    expect(full).not.toContain('"common_types.json":');
    const names = buildCatalogContextValue(catalog, { includeSchema: false });
    expect(names).toContain("Editor");
    expect(names).toContain("Parts");
    expect(names).not.toContain('"type"');
  });
});
