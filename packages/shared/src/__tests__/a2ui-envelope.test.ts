import { describe, expect, it } from "vitest";
import { envelopeToManifest, readCopilotKitUIEnvelope } from "../a2ui-envelope";
import type { CopilotKitUIEnvelope } from "../a2ui-envelope";

type InlineCatalog = NonNullable<
  CopilotKitUIEnvelope["v1.0"]["inlineCatalogs"]
>[number];
type Extensions = CopilotKitUIEnvelope["metadata"]["extensions"];

const productGrid = {
  description: "A grid of products.",
  props: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
  events: { onSelect: { parameters: { type: "object" } } },
  slots: { children: "multiple" as const },
};
const addToCart = { description: "Add.", parameters: { type: "object" } };
const targets: Extensions["copilotkit_targets"] = [
  { id: "chat", kind: "chat" },
  {
    id: "sidebar",
    kind: "inline",
    description: "Right column.",
    components: ["ProductGrid"],
  },
];
const surfaces: Extensions["copilotkit_surfaces"] = {
  cart: { target: "sidebar" },
  form: {
    target: "chat",
    dataModel: { "/form/email": "me@x.io" },
    rejected: ["operation 2: unknown component Foo"],
  },
};

function createCatalog(overrides?: Partial<InlineCatalog>): InlineCatalog {
  return {
    catalogId: "acme/app@1",
    protocolVersion: "1.0",
    components: { ProductGrid: productGrid },
    functions: { addToCart },
    instructions: "Write fences.",
    ...overrides,
  };
}

function createEnvelope(options?: {
  catalog?: Partial<InlineCatalog>;
  extensions?: Partial<Extensions>;
}): CopilotKitUIEnvelope {
  return {
    "v1.0": {
      supportedCatalogIds: ["acme/app@1"],
      inlineCatalogs: [createCatalog(options?.catalog)],
    },
    metadata: {
      extensions: {
        copilotkit_format: 3,
        copilotkit_transport: "markdown",
        copilotkit_targets: targets,
        copilotkit_surfaces: surfaces,
        copilotkit_contextSent: true,
        ...options?.extensions,
      },
    },
  };
}

/** Reads `ui` from `forwardedProps.copilotkit.ui`. */
const readUI = (ui: unknown) =>
  readCopilotKitUIEnvelope({ copilotkit: { ui }, other: 1 });

/** An envelope with one key of the inline catalog replaced by any value. */
const withCatalogField = (key: string, value: unknown) => {
  const envelope = createEnvelope();
  return {
    ...envelope,
    "v1.0": {
      ...envelope["v1.0"],
      inlineCatalogs: [{ ...createCatalog(), [key]: value }],
    },
  };
};

/** An envelope with one key of the capabilities replaced by any value. */
const withCapability = (key: string, value: unknown) => {
  const envelope = createEnvelope();
  return { ...envelope, "v1.0": { ...envelope["v1.0"], [key]: value } };
};

/** An envelope with one CopilotKit extension replaced by any value. */
const withExtension = (key: string, value: unknown) => {
  const envelope = createEnvelope();
  return {
    ...envelope,
    metadata: {
      extensions: { ...envelope.metadata.extensions, [key]: value },
    },
  };
};

describe("readCopilotKitUIEnvelope", () => {
  it("reads a markdown envelope from forwardedProps.copilotkit.ui", () => {
    const envelope = createEnvelope();
    expect(readUI(envelope)).toEqual(envelope);
  });

  it("reads a tool envelope without instructions and without components", () => {
    const envelope: CopilotKitUIEnvelope = {
      "v1.0": {
        supportedCatalogIds: ["acme/app@1"],
        inlineCatalogs: [
          { catalogId: "acme/app@1", protocolVersion: "1.0", functions: {} },
        ],
      },
      metadata: {
        extensions: {
          copilotkit_format: 3,
          copilotkit_transport: "tool",
          copilotkit_targets: [],
          copilotkit_surfaces: {},
          copilotkit_contextSent: false,
        },
      },
    };
    expect(readUI(envelope)).toEqual(envelope);
  });

  it("reads an envelope without inline catalogs", () => {
    const envelope: CopilotKitUIEnvelope = {
      ...createEnvelope(),
      "v1.0": { supportedCatalogIds: ["acme/app@1"] },
    };
    expect(readUI(envelope)).toEqual(envelope);
  });

  it("reads an envelope that carries other extensions too", () => {
    const envelope = withExtension("a2ui_trace", { id: "t1" });
    expect(readUI(envelope)).toEqual(envelope);
  });

  it("reads a target with 100 component names", () => {
    const envelope = createEnvelope({
      extensions: {
        copilotkit_targets: [
          { id: "x", kind: "inline", components: Array(100).fill("Card") },
        ],
      },
    });
    expect(readUI(envelope)).toEqual(envelope);
  });

  it("reads a surface with 20 rejections of 500 characters", () => {
    const envelope = createEnvelope({
      extensions: {
        copilotkit_surfaces: {
          cart: { target: "chat", rejected: Array(20).fill("x".repeat(500)) },
        },
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
    [
      "the format 2 envelope",
      {
        method: "a2ui",
        version: "v0.9",
        format: 2,
        transport: "tool",
        catalog: { id: "acme/app", version: "1" },
        functions: {},
        targets: [],
        surfaces: {},
        contextSent: false,
      },
    ],
    ["format 2 in the extensions", withExtension("copilotkit_format", 2)],
    ["an unknown transport", withExtension("copilotkit_transport", "fence")],
    ["no capabilities", { ...createEnvelope(), "v1.0": undefined }],
    ["no metadata", { ...createEnvelope(), metadata: undefined }],
    ["no extensions", { ...createEnvelope(), metadata: {} }],
    ["no catalog id", withCapability("supportedCatalogIds", [])],
    ["an empty catalog id", withCapability("supportedCatalogIds", [""])],
    [
      "inline catalogs that are not a list",
      withCapability("inlineCatalogs", {}),
    ],
    [
      "an inline catalog without an id",
      withCatalogField("catalogId", undefined),
    ],
    [
      "an inline catalog of protocol 0.9",
      withCatalogField("protocolVersion", "0.9"),
    ],
    [
      "a component without a props schema",
      withCatalogField("components", { Card: { description: "x" } }),
    ],
    [
      "a component whose required list is not strings",
      withCatalogField("components", {
        Card: { props: { type: "object", required: 5 } },
      }),
    ],
    [
      "an unknown slot kind",
      withCatalogField("components", {
        Card: { props: {}, slots: { body: "many" } },
      }),
    ],
    [
      "an event without parameters",
      withCatalogField("components", {
        Card: { props: {}, events: { onClick: {} } },
      }),
    ],
    [
      "a function without parameters",
      withCatalogField("functions", { add: {} }),
    ],
    [
      "an inline catalog without functions",
      withCatalogField("functions", undefined),
    ],
    ["instructions that are not text", withCatalogField("instructions", ["a"])],
    [
      "targets that are not a list",
      withExtension("copilotkit_targets", { chat: "chat" }),
    ],
    [
      "a target with an unknown kind",
      withExtension("copilotkit_targets", [{ id: "x", kind: "modal" }]),
    ],
    [
      "a surface without a target",
      withExtension("copilotkit_surfaces", { cart: {} }),
    ],
    [
      "a surface data model that is not an object",
      withExtension("copilotkit_surfaces", {
        cart: { target: "chat", dataModel: ["a"] },
      }),
    ],
    [
      "surface rejections that are not strings",
      withExtension("copilotkit_surfaces", {
        cart: { target: "chat", rejected: [1] },
      }),
    ],
    [
      "more than 20 surface rejections",
      withExtension("copilotkit_surfaces", {
        cart: { target: "chat", rejected: Array(21).fill("operation 0: x") },
      }),
    ],
    [
      "a surface rejection longer than 500 characters",
      withExtension("copilotkit_surfaces", {
        cart: { target: "chat", rejected: ["x".repeat(501)] },
      }),
    ],
    [
      "target components that are not a list",
      withExtension("copilotkit_targets", [
        { id: "x", kind: "inline", components: "ProductGrid" },
      ]),
    ],
    [
      "a target component name that is empty",
      withExtension("copilotkit_targets", [
        { id: "x", kind: "inline", components: ["ProductGrid", ""] },
      ]),
    ],
    [
      "more than 100 target component names",
      withExtension("copilotkit_targets", [
        { id: "x", kind: "inline", components: Array(101).fill("ProductGrid") },
      ]),
    ],
    ["no contextSent flag", withExtension("copilotkit_contextSent", undefined)],
  ])("returns undefined for %s", (_case, ui) => {
    expect(readUI(ui)).toBeUndefined();
  });
});

describe("envelopeToManifest", () => {
  it("returns the manifest, the transport, the context flag, and the instructions", () => {
    expect(envelopeToManifest(createEnvelope())).toEqual({
      catalogId: "acme/app@1",
      catalogIds: ["acme/app@1"],
      components: { ProductGrid: productGrid },
      functions: { addToCart },
      targets,
      surfaces,
      transport: "markdown",
      contextSent: true,
      instructions: "Write fences.",
      hasComponents: true,
    });
  });

  it("gives the action of the user event that started the run", () => {
    const action = {
      version: "v1.0" as const,
      action: {
        name: "buy",
        surfaceId: "s1",
        sourceComponentId: "button",
        timestamp: "2026-10-20T10:00:00.000Z",
        userMessage: "Buy now",
        context: { sku: "a" },
      },
    };
    const envelope = createEnvelope({
      extensions: { copilotkit_action: action },
    });
    expect(readCopilotKitUIEnvelope({ copilotkit: { ui: envelope } })).toEqual(
      envelope,
    );
    expect(envelopeToManifest(envelope).action).toEqual(action);
  });

  it("reports no components when the client left them out", () => {
    const manifest = envelopeToManifest(
      createEnvelope({
        catalog: { components: undefined, instructions: undefined },
        extensions: { copilotkit_transport: "tool" },
      }),
    );
    expect(manifest).toMatchObject({
      components: {},
      functions: { addToCart },
      transport: "tool",
      hasComponents: false,
    });
    expect(manifest.instructions).toBeUndefined();
  });

  it("lists every supported catalog id, the first one as the catalog of the run", () => {
    const envelope: CopilotKitUIEnvelope = {
      ...createEnvelope(),
      "v1.0": {
        supportedCatalogIds: ["acme/app@1", "copilotkit/standard@1"],
        inlineCatalogs: [createCatalog()],
      },
    };
    expect(envelopeToManifest(envelope)).toMatchObject({
      catalogId: "acme/app@1",
      catalogIds: ["acme/app@1", "copilotkit/standard@1"],
      components: { ProductGrid: productGrid },
    });
  });

  it("uses only the inline catalog of the first supported catalog id", () => {
    const envelope: CopilotKitUIEnvelope = {
      ...createEnvelope(),
      "v1.0": {
        supportedCatalogIds: ["acme/app@1"],
        inlineCatalogs: [createCatalog({ catalogId: "other/catalog" })],
      },
    };
    expect(envelopeToManifest(envelope)).toMatchObject({
      catalogId: "acme/app@1",
      components: {},
      functions: {},
      hasComponents: false,
    });
  });
});

describe("component parameter order", () => {
  it("preserves ordering through the capability envelope", () => {
    const component = {
      ...productGrid,
      parameterOrder: ["children", "onSelect", "title"],
    };
    const envelope = createEnvelope({
      catalog: { components: { ProductGrid: component } },
    });
    const parsed = readUI(JSON.parse(JSON.stringify(envelope)))!;
    expect(
      envelopeToManifest(parsed).components.ProductGrid.parameterOrder,
    ).toEqual(component.parameterOrder);
  });
  it.each(["title", ["title", "title"], ["unknown"], [42], ["__proto__"]])(
    "rejects invalid metadata %j",
    (parameterOrder) => {
      const envelope = createEnvelope();
      const catalog = envelope["v1.0"].inlineCatalogs![0];
      const invalid = {
        ...catalog,
        components: { ProductGrid: { ...productGrid, parameterOrder } },
      };
      expect(
        readUI({
          ...envelope,
          "v1.0": { ...envelope["v1.0"], inlineCatalogs: [invalid] },
        }),
      ).toBeUndefined();
    },
  );
});
