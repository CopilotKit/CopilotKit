import { EventType } from "@ag-ui/client";
import type {
  ActivityDeltaEvent,
  ActivitySnapshotEvent,
  BaseEvent,
} from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { validateOperation } from "@copilotkit/shared";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import {
  STANDARD_CATALOG_ID,
  catalogIdsOf,
  createGenerativeUI,
  standardDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import {
  createA2UIV09ActivityUpgrader,
  isA2UIV09Operation,
  upgradeA2UIV09Operations,
} from "../generative-ui/a2ui-v09-operations";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

// The standard catalog as the client sees it, with no framework components.
const Noop = () => null;
const standardUI = createGenerativeUI({
  id: STANDARD_CATALOG_ID,
  components: withComponents(
    standardDeclarations,
    Object.fromEntries(
      Object.keys(standardDeclarations).map((name) => [name, Noop]),
    ) as Record<keyof typeof standardDeclarations, typeof Noop>,
  ) as never,
});
const manifest = {
  catalogId: standardUI.id,
  catalogIds: catalogIdsOf(standardUI),
  components: standardUI.manifestComponents,
};

/** Validates operations in order, as the client applies a surface's content. */
function expectValid(operations: unknown[], existing: string[] = []) {
  const knownSurfaces = new Set(existing);
  const createdSurfaces = new Set(existing);
  for (const op of operations) {
    const result = validateOperation(op, {
      manifest,
      knownSurfaces,
      createdSurfaces,
    });
    expect(result, JSON.stringify(op)).toEqual({ ok: true });
    const create = (op as { createSurface?: { surfaceId: string } })
      .createSurface;
    if (create) {
      knownSurfaces.add(create.surfaceId);
      createdSurfaces.add(create.surfaceId);
    }
  }
}

const create = (surfaceId = "s", catalogId = BASIC_CATALOG_ID) => ({
  version: "v0.9",
  createSurface: { surfaceId, catalogId },
});
const update = (components: unknown[], surfaceId = "s") => ({
  version: "v0.9",
  updateComponents: { surfaceId, components },
});
const setData = (fields: { path?: string; value?: unknown }) => ({
  version: "v0.9",
  updateDataModel: { surfaceId: "s", ...fields },
});

/** The 1.0 components of one converted updateComponents. */
function convertComponents(...components: unknown[]) {
  const { operations, dropped } = upgradeA2UIV09Operations([
    update(components),
  ]);
  expect(dropped).toEqual([]);
  expectValid(operations, ["s"]);
  return (
    operations[0] as Extract<A2UIOperation, { updateComponents: unknown }>
  ).updateComponents.components;
}

describe("isA2UIV09Operation", () => {
  it("is true for the v0.9 versions", () => {
    expect(isA2UIV09Operation(create())).toBe(true);
    expect(isA2UIV09Operation({ ...create(), version: "v0.9.1" })).toBe(true);
  });

  it("is true for a versionless operation with one v0.9 key", () => {
    expect(isA2UIV09Operation({ deleteSurface: { surfaceId: "s" } })).toBe(
      true,
    );
  });

  it("is false for 1.0, v0.8, other versions and malformed values", () => {
    expect(
      isA2UIV09Operation({ version: "1.0", deleteSurface: { surfaceId: "s" } }),
    ).toBe(false);
    expect(isA2UIV09Operation({ surfaceUpdate: { surfaceId: "s" } })).toBe(
      false,
    );
    expect(
      isA2UIV09Operation({
        version: "v0.8",
        deleteSurface: { surfaceId: "s" },
      }),
    ).toBe(false);
    expect(isA2UIV09Operation({ deleteSurface: "s" })).toBe(false);
    expect(
      isA2UIV09Operation({
        deleteSurface: { surfaceId: "s" },
        createSurface: { surfaceId: "s" },
      }),
    ).toBe(false);
    expect(isA2UIV09Operation(null)).toBe(false);
    expect(isA2UIV09Operation([create()])).toBe(false);
  });
});

// One case per row of "Bindings and actions" in from-a2ui.mdx.
describe("upgradeA2UIV09Operations: the from-a2ui table", () => {
  it('turns { "path" } into { "@path" }', () => {
    expect(
      convertComponents({
        id: "root",
        component: "Text",
        text: { path: "/total" },
      }),
    ).toEqual([{ id: "root", component: "Text", text: { "@path": "/total" } }]);
  });

  it("keeps literals and converts function calls at any depth", () => {
    expect(
      convertComponents({
        id: "root",
        component: "ChoicePicker",
        label: "Size",
        options: [
          { label: "Small", value: "s" },
          {
            label: {
              call: "formatCurrency",
              args: { value: { path: "/price" }, currency: "USD" },
              returnType: "string",
            },
            value: "m",
          },
        ],
        value: ["s"],
      }),
    ).toEqual([
      {
        id: "root",
        component: "ChoicePicker",
        label: "Size",
        options: [
          { label: "Small", value: "s" },
          {
            label: {
              "@call": "formatCurrency",
              args: { value: { "@path": "/price" }, currency: "USD" },
            },
            value: "m",
          },
        ],
        value: ["s"],
      },
    ]);
  });

  it("turns a formatString call into the @call form", () => {
    expect(
      convertComponents({
        id: "root",
        component: "Text",
        text: {
          call: "formatString",
          args: { value: "Hello ${/user/name}" },
        },
      }),
    ).toEqual([
      {
        id: "root",
        component: "Text",
        text: {
          "@call": "formatString",
          args: { value: "Hello ${/user/name}" },
        },
      },
    ]);
  });

  it("turns a Button event action into an onClick event", () => {
    expect(
      convertComponents(
        {
          id: "root",
          component: "Button",
          child: "label",
          action: {
            event: {
              name: "buy",
              context: { sku: "a1", qty: { path: "/form/qty" } },
            },
          },
        },
        { id: "label", component: "Text", text: "Buy" },
      ),
    ).toEqual([
      {
        id: "root",
        component: "Button",
        child: "label",
        onClick: {
          event: {
            name: "buy",
            context: { sku: "a1", qty: { "@path": "/form/qty" } },
          },
        },
      },
      { id: "label", component: "Text", text: "Buy" },
    ]);
  });

  it("turns a Button functionCall action into an onClick functionCall", () => {
    expect(
      convertComponents({
        id: "root",
        component: "Button",
        action: {
          functionCall: {
            call: "openUrl",
            args: { url: "https://example.com" },
            returnType: "void",
          },
        },
      }),
    ).toEqual([
      {
        id: "root",
        component: "Button",
        onClick: {
          functionCall: {
            "@call": "openUrl",
            args: { url: "https://example.com" },
          },
        },
      },
    ]);
  });

  it("keeps child lists and templates", () => {
    expect(
      convertComponents(
        { id: "root", component: "Column", children: ["list"] },
        {
          id: "list",
          component: "List",
          children: { componentId: "row", path: "/items" },
        },
        { id: "row", component: "Text", text: { path: "name" } },
      ),
    ).toEqual([
      { id: "root", component: "Column", children: ["list"] },
      {
        id: "list",
        component: "List",
        children: { componentId: "row", path: "/items" },
      },
      { id: "row", component: "Text", text: { "@path": "name" } },
    ]);
  });

  it("converts the conditions of checks", () => {
    expect(
      convertComponents({
        id: "root",
        component: "TextField",
        label: "Email",
        value: { path: "/form/email" },
        checks: [
          {
            condition: {
              call: "email",
              args: { value: { path: "/form/email" } },
            },
            message: "Enter an email",
          },
        ],
      }),
    ).toEqual([
      {
        id: "root",
        component: "TextField",
        label: "Email",
        value: { "@path": "/form/email" },
        checks: [
          {
            condition: {
              "@call": "email",
              args: { value: { "@path": "/form/email" } },
            },
            message: "Enter an email",
          },
        ],
      },
    ]);
  });

  it("drops an operation that is not a v0.9 surface operation", () => {
    // v0.9 has no agent function call either; nothing to convert it to.
    const op = { version: "v0.9", callFunction: { name: "addToCart" } };
    expect(upgradeA2UIV09Operations([op])).toEqual({
      operations: [],
      dropped: [
        {
          operation: op,
          reason:
            "operation must contain exactly one of createSurface, updateComponents, updateDataModel, deleteSurface",
        },
      ],
    });
  });
});

describe("upgradeA2UIV09Operations: basic catalog components", () => {
  it("turns Text heading variants into Title sizes", () => {
    const sizes = ["h1", "h2", "h3", "h4", "h5"].map((variant) => {
      const [node] = convertComponents({
        id: "root",
        component: "Text",
        text: "Hi",
        variant,
        weight: 1,
      });
      expect(node).not.toHaveProperty("variant");
      expect(node).not.toHaveProperty("weight");
      expect(node.component).toBe("Title");
      return node.size;
    });
    expect(sizes).toEqual(["2xl", "xl", "lg", "md", "sm"]);
  });

  it("turns a caption Text into Caption, and a body Text into Text", () => {
    expect(
      convertComponents(
        { id: "c", component: "Text", text: "Note", variant: "caption" },
        {
          id: "b",
          component: "Text",
          text: "Body",
          variant: "body",
          weight: 1,
        },
      ),
    ).toEqual([
      { id: "c", component: "Caption", text: "Note" },
      { id: "b", component: "Text", text: "Body", weight: 1 },
    ]);
  });

  it("keeps the props of the media components", () => {
    const nodes = [
      {
        id: "img",
        component: "Image",
        url: { path: "/photo" },
        description: "A cat",
        fit: "scaleDown",
        variant: "avatar",
      },
      { id: "icon", component: "Icon", name: "arrowBack" },
      { id: "bound-icon", component: "Icon", name: { path: "/icon" } },
      { id: "svg-icon", component: "Icon", name: { svgPath: "M0 0h24" } },
      { id: "video", component: "Video", url: "https://example.com/a.mp4" },
      {
        id: "audio",
        component: "AudioPlayer",
        url: "https://example.com/a.mp3",
        description: "Intro",
      },
    ];
    const converted = convertComponents(...nodes);
    expect(converted[0]).toEqual({ ...nodes[0], url: { "@path": "/photo" } });
    expect(converted[2]).toEqual({ ...nodes[2], name: { "@path": "/icon" } });
    expect([converted[1], ...converted.slice(3)]).toEqual([
      nodes[1],
      ...nodes.slice(3),
    ]);
  });

  it("keeps the props of the layout components", () => {
    const nodes = [
      {
        id: "root",
        component: "Column",
        children: ["row", "card", "tabs", "modal", "line"],
        justify: "spaceBetween",
        align: "stretch",
      },
      {
        id: "row",
        component: "Row",
        children: ["list"],
        justify: "center",
        align: "end",
        weight: 2,
      },
      {
        id: "list",
        component: "List",
        children: ["t"],
        direction: "horizontal",
        align: "center",
      },
      { id: "card", component: "Card", child: "t" },
      {
        id: "tabs",
        component: "Tabs",
        tabs: [
          { title: "One", child: "t" },
          { title: { path: "/tab2" }, child: "t2" },
        ],
      },
      { id: "modal", component: "Modal", trigger: "t", content: "t2" },
      { id: "line", component: "Divider", axis: "vertical" },
      { id: "t", component: "Text", text: "x" },
      { id: "t2", component: "Text", text: "y" },
    ];
    const converted = convertComponents(...nodes);
    expect(converted[4]).toEqual({
      ...nodes[4],
      tabs: [
        { title: "One", child: "t" },
        { title: { "@path": "/tab2" }, child: "t2" },
      ],
    });
    expect(converted.filter((_, i) => i !== 4)).toEqual(
      nodes.filter((_, i) => i !== 4),
    );
  });

  it("keeps Button child, variant and checks", () => {
    expect(
      convertComponents({
        id: "root",
        component: "Button",
        child: "label",
        variant: "borderless",
        checks: [{ condition: { path: "/ok" }, message: "Not yet" }],
        action: { event: { name: "go" } },
      }),
    ).toEqual([
      {
        id: "root",
        component: "Button",
        child: "label",
        variant: "borderless",
        checks: [{ condition: { "@path": "/ok" }, message: "Not yet" }],
        onClick: { event: { name: "go" } },
      },
    ]);
  });

  it("turns TextField validationRegexp into a regex check", () => {
    expect(
      convertComponents({
        id: "root",
        component: "TextField",
        label: "Zip",
        value: { path: "/zip" },
        variant: "number",
        validationRegexp: "^[0-9]{5}$",
      }),
    ).toEqual([
      {
        id: "root",
        component: "TextField",
        label: "Zip",
        value: { "@path": "/zip" },
        variant: "number",
        checks: [
          {
            condition: {
              "@call": "regex",
              args: { value: { "@path": "/zip" }, pattern: "^[0-9]{5}$" },
            },
          },
        ],
      },
    ]);
  });

  it("drops validationRegexp from a TextField with no value", () => {
    expect(
      convertComponents({
        id: "root",
        component: "TextField",
        label: "Zip",
        validationRegexp: "^[0-9]{5}$",
      }),
    ).toEqual([{ id: "root", component: "TextField", label: "Zip" }]);
  });

  it("keeps the props of the other input components", () => {
    const nodes = [
      {
        id: "check",
        component: "CheckBox",
        label: "Agree",
        value: { path: "/agree" },
      },
      {
        id: "pick",
        component: "ChoicePicker",
        label: "Toppings",
        variant: "multipleSelection",
        options: [{ label: { path: "/cheese" }, value: "cheese" }],
        value: { path: "/toppings" },
        displayStyle: "chips",
        filterable: true,
      },
      {
        id: "slide",
        component: "Slider",
        label: "Volume",
        min: 0,
        max: 11,
        value: { path: "/volume" },
      },
      {
        id: "date",
        component: "DateTimeInput",
        label: "When",
        value: { path: "/when" },
        enableDate: true,
        enableTime: true,
        min: "2026-01-01",
        max: { path: "/latest" },
        accessibility: { label: "Date", description: { path: "/hint" } },
      },
    ];
    expect(convertComponents(...nodes)).toEqual([
      { ...nodes[0], value: { "@path": "/agree" } },
      {
        ...nodes[1],
        options: [{ label: { "@path": "/cheese" }, value: "cheese" }],
        value: { "@path": "/toppings" },
      },
      { ...nodes[2], value: { "@path": "/volume" } },
      {
        ...nodes[3],
        value: { "@path": "/when" },
        max: { "@path": "/latest" },
        accessibility: { label: "Date", description: { "@path": "/hint" } },
      },
    ]);
  });

  it("converts the action of a custom component without renaming it", () => {
    const { operations } = upgradeA2UIV09Operations([
      update([
        {
          id: "root",
          component: "ProductCard",
          action: { event: { name: "add", context: { id: { path: "/id" } } } },
        },
      ]),
    ]);
    expect(operations).toEqual([
      {
        version: "1.0",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "ProductCard",
              action: {
                event: { name: "add", context: { id: { "@path": "/id" } } },
              },
            },
          ],
        },
      },
    ]);
  });
});

describe("upgradeA2UIV09Operations: surface operations", () => {
  it("maps the v0.9 basic catalog ids to the standard catalog", () => {
    const { operations } = upgradeA2UIV09Operations([
      create("a"),
      create(
        "b",
        "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
      ),
    ]);
    expect(operations).toEqual([
      {
        version: "1.0",
        createSurface: { surfaceId: "a", catalogId: STANDARD_CATALOG_ID },
      },
      {
        version: "1.0",
        createSurface: { surfaceId: "b", catalogId: STANDARD_CATALOG_ID },
      },
    ]);
    expect(STANDARD_CATALOG_ID).toBe("copilotkit/standard@1");
    expectValid(operations);
  });

  it("keeps another catalog id, sendDataModel, and drops theme", () => {
    expect(
      upgradeA2UIV09Operations([
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "s",
            catalogId: "acme/flights",
            theme: { primaryColor: "#00BFFF" },
            sendDataModel: true,
          },
        },
        { version: "v0.9", createSurface: { surfaceId: "t" } },
      ]).operations,
    ).toEqual([
      {
        version: "1.0",
        createSurface: {
          surfaceId: "s",
          catalogId: "acme/flights",
          sendDataModel: true,
        },
      },
      { version: "1.0", createSurface: { surfaceId: "t" } },
    ]);
  });

  it("converts updateDataModel removals and relative paths", () => {
    const { operations, dropped } = upgradeA2UIV09Operations([
      setData({ path: "/form/name", value: "Ada" }),
      setData({ path: "form/name" }),
      setData({}),
      setData({ value: { form: { name: "" } } }),
    ]);
    expect(dropped).toEqual([]);
    expect(
      operations.map((op) => "updateDataModel" in op && op.updateDataModel),
    ).toEqual([
      { surfaceId: "s", path: "/form/name", value: "Ada" },
      { surfaceId: "s", path: "/form/name", value: null },
      { surfaceId: "s", path: "/", value: {} },
      { surfaceId: "s", path: "/", value: { form: { name: "" } } },
    ]);
    expectValid(operations, ["s"]);
  });

  it("converts deleteSurface and keeps a 1.0 operation as it is", () => {
    const native = { version: "1.0", deleteSurface: { surfaceId: "t" } };
    expect(
      upgradeA2UIV09Operations([
        { version: "v0.9", deleteSurface: { surfaceId: "s" } },
        native,
      ]).operations,
    ).toEqual([{ version: "1.0", deleteSurface: { surfaceId: "s" } }, native]);
  });

  it("drops what it cannot convert, with a reason, and never throws", () => {
    const hostile = {
      version: "v0.9",
      get updateComponents() {
        throw new Error("boom");
      },
    };
    const cases: Array<[unknown, string]> = [
      ["text", "operation must be a JSON object"],
      [{ surfaceUpdate: { surfaceId: "s" } }, "not an A2UI v0.9 operation"],
      [
        { version: "v0.8", deleteSurface: { surfaceId: "s" } },
        'unsupported A2UI version "v0.8"',
      ],
      [
        {
          version: "v0.9",
          createSurface: { surfaceId: "s" },
          deleteSurface: { surfaceId: "s" },
        },
        "exactly one of",
      ],
      [{ version: "v0.9", deleteSurface: {} }, "deleteSurface.surfaceId"],
      [update([]), "non-empty array"],
      [update([{ component: "Text" }]), "a component needs a string id"],
      [
        update([{ id: "root", component: { Text: { text: "v0.8" } } }]),
        'component "root": the component type must be a string',
      ],
      [
        update([{ id: "root", component: "Button", action: "go" }]),
        'component "root": action must be',
      ],
      [
        update([
          {
            id: "root",
            component: "Button",
            action: { event: { context: {} } },
          },
        ]),
        "action.event.name is required",
      ],
      [setData({ path: "/", value: [1] }), "must be a JSON object"],
      [setData({ path: 3 } as never), "path must be a string"],
      [hostile, "could not be read: boom"],
    ];
    const { operations, dropped } = upgradeA2UIV09Operations(
      cases.map(([op]) => op),
    );
    expect(operations).toEqual([]);
    expect(dropped).toHaveLength(cases.length);
    dropped.forEach((entry, index) => {
      expect(entry.operation).toBe(cases[index][0]);
      expect(entry.reason).toContain(cases[index][1]);
    });
  });
});

// ---- Native A2UI 1.0 operations ----

const V10_BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

/**
 * The native 1.0 operations of an ADK agent: the fixture of #8353
 * (`react-core/src/v2/__tests__/fixtures/a2ui-1-0.json`), from ag-ui #3374
 * `test_a2ui_protocol_versions.py::_ops` at 89a59e1.
 */
const adkOperations = [
  {
    version: "1.0",
    createSurface: { surfaceId: "s", catalogId: V10_BASIC_CATALOG_ID },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s",
      components: [{ id: "root", component: "Text", text: "Hello" }],
    },
  },
  {
    version: "1.0",
    updateDataModel: { surfaceId: "s", path: "/", value: {} },
  },
];

describe("upgradeA2UIV09Operations: native 1.0 operations", () => {
  it("maps the 1.0 basic catalog id of the ADK fixture to the standard catalog", () => {
    const { operations, dropped } = upgradeA2UIV09Operations(adkOperations);
    expect(dropped).toEqual([]);
    expect(operations).toEqual([
      {
        version: "1.0",
        createSurface: { surfaceId: "s", catalogId: STANDARD_CATALOG_ID },
      },
      adkOperations[1],
      adkOperations[2],
    ]);
    expectValid(operations);
  });

  it("gives inline and updated basic components the standard names", () => {
    // A native form, as the 1.0 basic catalog writes it (#8353).
    const components = [
      { id: "root", component: "Column", children: ["title", "save"] },
      { id: "title", component: "Text", variant: "h2", text: "Profile" },
      {
        id: "save",
        component: "Button",
        child: "label",
        action: {
          event: {
            name: "save",
            userMessage: "Save the form",
            context: { name: { "@path": "/name" } },
          },
        },
      },
      { id: "label", component: "Text", text: "Save" },
    ];
    const { operations, dropped } = upgradeA2UIV09Operations([
      {
        version: "1.0",
        createSurface: {
          surfaceId: "s",
          catalogId: V10_BASIC_CATALOG_ID,
          components,
          dataModel: { name: "Ada" },
        },
      },
      {
        version: "1.0",
        updateComponents: { surfaceId: "s", components: [components[1]] },
      },
    ]);
    expect(dropped).toEqual([]);
    const title = {
      id: "title",
      component: "Title",
      text: "Profile",
      size: "xl",
    };
    expect(operations).toEqual([
      {
        version: "1.0",
        createSurface: {
          surfaceId: "s",
          catalogId: STANDARD_CATALOG_ID,
          components: [
            components[0],
            title,
            {
              id: "save",
              component: "Button",
              child: "label",
              onClick: components[2].action,
            },
            components[3],
          ],
          dataModel: { name: "Ada" },
        },
      },
      {
        version: "1.0",
        updateComponents: { surfaceId: "s", components: [title] },
      },
    ]);
    expectValid(operations);
  });

  it("keeps another catalog id and its components", () => {
    const native = {
      version: "1.0",
      createSurface: {
        surfaceId: "s",
        catalogId: "https://example.test/catalog",
        components: [{ id: "root", component: "ProductCard", name: "Team" }],
      },
    };
    expect(upgradeA2UIV09Operations([native])).toEqual({
      operations: [native],
      dropped: [],
    });
  });
});

// ---- The activity upgrader ----

const surfaceSnapshot = (
  messageId: string,
  operations: unknown[],
): ActivitySnapshotEvent => ({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId,
  activityType: "a2ui-surface",
  content: { a2ui_operations: operations },
  replace: true,
});

const card = [
  { id: "root", component: "Card", child: "name" },
  { id: "name", component: "Text", text: { path: "/name" } },
];

function contentOf(event: BaseEvent) {
  expect(event).toMatchObject({
    type: EventType.ACTIVITY_SNAPSHOT,
    activityType: "generative-ui-surface",
    replace: true,
  });
  return (event as ActivitySnapshotEvent).content as GenerativeUISurfaceContent;
}

describe("createA2UIV09ActivityUpgrader", () => {
  it("passes every other event through unchanged", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    const others: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as BaseEvent,
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "m",
        delta: "hi",
      } as BaseEvent,
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "genui:x",
        activityType: "generative-ui-surface",
        content: { surfaceId: "x" },
      } as BaseEvent,
      {
        type: EventType.ACTIVITY_DELTA,
        messageId: "genui:x",
        activityType: "generative-ui-surface",
        patch: [],
      } as BaseEvent,
    ];
    for (const event of others) {
      const out = upgrader.transform(event);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe(event);
    }
  });

  it("turns the streamed snapshots of a surface into cumulative 1.0 snapshots", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    // What @ag-ui/a2ui-middleware streams for one render_a2ui call: the
    // components first, then the same operations with the data.
    const first = upgrader.transform(
      surfaceSnapshot("a2ui-surface-call1", [create(), update(card)]),
    );
    const second = upgrader.transform(
      surfaceSnapshot("a2ui-surface-call1", [
        create(),
        update(card),
        setData({ path: "/", value: { name: "Ada" } }),
      ]),
    );
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatchObject({ messageId: "genui:s" });
    expect(second[0]).toMatchObject({ messageId: "genui:s" });
    const content = contentOf(second[0]);
    expect(content).toEqual({
      surfaceId: "s",
      target: "chat",
      catalogId: STANDARD_CATALOG_ID,
      operations: [
        {
          version: "1.0",
          createSurface: { surfaceId: "s", catalogId: STANDARD_CATALOG_ID },
        },
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "s",
            components: [
              { id: "root", component: "Card", child: "name" },
              { id: "name", component: "Text", text: { "@path": "/name" } },
            ],
          },
        },
        {
          version: "1.0",
          updateDataModel: {
            surfaceId: "s",
            path: "/",
            value: { name: "Ada" },
          },
        },
      ],
      status: "ready",
      rejected: [],
      a2uiSourceVersion: "0.9",
    });
    // The second content extends the first, so the client applies only the
    // new operation.
    expect(content.operations.slice(0, 2)).toEqual(
      contentOf(first[0]).operations,
    );
    expectValid(content.operations);
  });

  it("sends nothing for a snapshot that changes nothing", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    const event = surfaceSnapshot("m1", [create(), update(card)]);
    expect(upgrader.transform(event)).toHaveLength(1);
    expect(upgrader.transform(event)).toEqual([]);
  });

  it("consumes lifecycle snapshots, which name no surface", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    expect(
      upgrader.transform({
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "a2ui-surface-call1",
        activityType: "a2ui-surface",
        content: { status: "building", progressTokens: 40 },
        replace: true,
      } as ActivitySnapshotEvent),
    ).toEqual([]);
  });

  it("applies a2ui-surface deltas and sends the new cumulative content", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    upgrader.transform(surfaceSnapshot("m1", [create(), update(card)]));
    const delta: ActivityDeltaEvent = {
      type: EventType.ACTIVITY_DELTA,
      messageId: "m1",
      activityType: "a2ui-surface",
      patch: [
        {
          op: "add",
          path: "/a2ui_operations/-",
          value: setData({ path: "/name", value: "Ada" }),
        },
      ],
    };
    const out = upgrader.transform(delta);
    expect(out).toHaveLength(1);
    const content = contentOf(out[0]);
    expect(content.operations).toHaveLength(3);
    expect(content.operations[2]).toEqual({
      version: "1.0",
      updateDataModel: { surfaceId: "s", path: "/name", value: "Ada" },
    });
    expectValid(content.operations);
  });

  it("ignores a delta for an unknown message or one that does not apply", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    const delta = (messageId: string, path: string): ActivityDeltaEvent => ({
      type: EventType.ACTIVITY_DELTA,
      messageId,
      activityType: "a2ui-surface",
      patch: [{ op: "replace", path, value: 1 }],
    });
    expect(upgrader.transform(delta("nope", "/a2ui_operations"))).toEqual([]);
    upgrader.transform(surfaceSnapshot("m1", [create(), update(card)]));
    expect(upgrader.transform(delta("m1", "/missing/deep"))).toEqual([]);
    // The stored content is unchanged, so the same snapshot sends nothing.
    expect(
      upgrader.transform(surfaceSnapshot("m1", [create(), update(card)])),
    ).toEqual([]);
  });

  it("keeps the first content of a replace: false snapshot", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    upgrader.transform(surfaceSnapshot("m1", [create(), update(card)]));
    expect(
      upgrader.transform({
        ...surfaceSnapshot("m1", [create("other")]),
        replace: false,
      }),
    ).toEqual([]);
  });

  it("reports dropped operations as rejected, at their index", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    const [event] = upgrader.transform(
      surfaceSnapshot("m1", [
        create(),
        update([{ id: "root", component: "Button", action: "go" }]),
        update(card),
      ]),
    );
    const content = contentOf(event);
    expect(content.operations).toHaveLength(2);
    expect(content.rejected).toEqual([
      { index: 1, reason: expect.stringContaining("action must be") },
    ]);
  });

  it("sends one surface per surfaceId of a message", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    const out = upgrader.transform(
      surfaceSnapshot("m1", [
        create("a"),
        create("b"),
        update(card, "a"),
        update(card, "b"),
      ]),
    );
    expect(
      out.map((event) => (event as ActivitySnapshotEvent).messageId),
    ).toEqual(["genui:a", "genui:b"]);
    for (const event of out) expectValid(contentOf(event).operations);
  });

  it("merges the messages of one surface and keeps only the first createSurface", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    upgrader.transform(surfaceSnapshot("m1", [create(), update(card)]));
    const [event] = upgrader.transform(
      surfaceSnapshot("m2", [
        create(),
        update([{ id: "name", component: "Text", text: "Grace" }]),
      ]),
    );
    const { operations } = contentOf(event);
    expect(operations.map((op) => Object.keys(op)[1])).toEqual([
      "createSurface",
      "updateComponents",
      "updateComponents",
    ]);
    expectValid(operations);
  });

  it("appends to a surface of an earlier run with a delta", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    // v0.9 updates an existing surface without a second createSurface.
    const [first] = upgrader.transform(
      surfaceSnapshot("m1", [
        update([{ id: "name", component: "Text", text: "Grace" }]),
      ]),
    );
    expect(first).toEqual({
      type: EventType.ACTIVITY_DELTA,
      messageId: "genui:s",
      activityType: "generative-ui-surface",
      patch: [
        {
          op: "add",
          path: "/operations/-",
          value: {
            version: "1.0",
            updateComponents: {
              surfaceId: "s",
              components: [{ id: "name", component: "Text", text: "Grace" }],
            },
          },
        },
      ],
    });
    expectValid(
      (first as ActivityDeltaEvent).patch.map(
        (entry) => (entry as { value: unknown }).value,
      ),
      ["s"],
    );
    // A later snapshot of the same message sends only what is new.
    const [second] = upgrader.transform(
      surfaceSnapshot("m1", [
        update([{ id: "name", component: "Text", text: "Grace" }]),
        setData({ path: "/x", value: 1 }),
      ]),
    );
    expect((second as ActivityDeltaEvent).patch).toEqual([
      {
        op: "add",
        path: "/operations/-",
        value: {
          version: "1.0",
          updateDataModel: { surfaceId: "s", path: "/x", value: 1 },
        },
      },
    ]);
  });

  it("turns a native 1.0 surface into a 1.0 surface without the v0.9 tag", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    const [event, ...rest] = upgrader.transform(
      surfaceSnapshot("a2ui-surface-call1", adkOperations),
    );
    expect(rest).toEqual([]);
    expect(event).toMatchObject({ messageId: "genui:s" });
    const content = contentOf(event);
    expect(content).toEqual({
      surfaceId: "s",
      target: "chat",
      catalogId: STANDARD_CATALOG_ID,
      operations: upgradeA2UIV09Operations(adkOperations).operations,
      status: "ready",
      rejected: [],
    });
    // A click on it is a 1.0 action, which reaches the agent unchanged.
    expect(content).not.toHaveProperty("a2uiSourceVersion");
    expectValid(content.operations);
  });

  it("rejects an operation of the other version on a surface", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    const [native] = upgrader.transform(
      surfaceSnapshot("m1", [adkOperations[0], update(card)]),
    );
    expect(contentOf(native).operations).toEqual([
      {
        version: "1.0",
        createSurface: { surfaceId: "s", catalogId: STANDARD_CATALOG_ID },
      },
    ]);
    expect(contentOf(native).rejected).toEqual([
      {
        index: 1,
        reason:
          'surface "s" is A2UI 1.0; an A2UI 0.9 operation cannot change it',
      },
    ]);
    expect(contentOf(native)).not.toHaveProperty("a2uiSourceVersion");

    const [converted] = createA2UIV09ActivityUpgrader().transform(
      surfaceSnapshot("m1", [create(), adkOperations[1]]),
    );
    expect(contentOf(converted).operations).toHaveLength(1);
    expect(contentOf(converted).rejected).toEqual([
      {
        index: 1,
        reason:
          'surface "s" is A2UI 0.9; an A2UI 1.0 operation cannot change it',
      },
    ]);
    expect(contentOf(converted).a2uiSourceVersion).toBe("0.9");
  });

  it("rejects an operation of an unknown version", () => {
    const upgrader = createA2UIV09ActivityUpgrader();
    const [event] = upgrader.transform(
      surfaceSnapshot("m1", [
        adkOperations[0],
        { ...adkOperations[1], version: "1.1" },
      ]),
    );
    expect(contentOf(event).rejected).toEqual([
      {
        index: 1,
        reason: expect.stringContaining('unsupported A2UI version "1.1"'),
      },
    ]);
  });
});
