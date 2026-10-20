import { describe, expect, it } from "vitest";
import {
  getOperationKind,
  getOperationSurfaceId,
  isIndexCall,
  isPathBinding,
  validateOperation,
} from "../validate-operation";
import type { ValidateOperationOptions } from "../validate-operation";
import { A2UI_COMPONENT_ID_REF } from "../child-refs";
import type { GenerativeUIManifest } from "../types";

const manifest: Pick<GenerativeUIManifest, "catalogId" | "components"> = {
  catalogId: "shop",
  components: {
    ProductGrid: {
      props: { type: "object", properties: { title: { type: "string" } } },
      slots: { children: "multiple" },
    },
    ProductCard: {
      props: {
        type: "object",
        properties: { name: { type: "string" }, price: { type: "number" } },
        required: ["name", "price"],
      },
      events: { onAddToCart: { parameters: { type: "object" } } },
    },
    Frame: {
      props: { type: "object", properties: {} },
      slots: { child: "single" },
    },
    // A typed child reference inside a list, as A2UI 1.0 Tabs has it.
    Tabs: {
      props: {
        type: "object",
        properties: {
          tabs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                child: { $ref: A2UI_COMPONENT_ID_REF },
              },
            },
          },
        },
      },
    },
  },
};
const functions = { addToCart: { parameters: { type: "object" } } };
const knownSurfaces = new Set(["s1"]);

const update = (...components: unknown[]) => ({
  version: "v1.0",
  updateComponents: { surfaceId: "s1", components },
});
const setData = (fields: { path?: string; value?: unknown }) => ({
  version: "v1.0",
  updateDataModel: { surfaceId: "s1", ...fields },
});
const create = (fields: Record<string, unknown>) => ({
  version: "v1.0",
  createSurface: { surfaceId: "s2", ...fields },
});
const callFunction = (fields: Record<string, unknown>) => ({
  version: "v1.0",
  callRendererFunction: { functionCallId: "f1", ...fields },
});
/** A valid ProductCard with `props` added or replaced. */
const card = (props: Record<string, unknown>) =>
  update({ id: "c1", component: "ProductCard", name: "A", price: 1, ...props });

const reasonOf = (
  op: unknown,
  options?: Partial<Omit<ValidateOperationOptions, "manifest">>,
) => {
  const result = validateOperation(op, { manifest, knownSurfaces, ...options });
  return result.ok ? "ok" : result.reason;
};

describe("validateOperation: version and kind", () => {
  it("rejects a v0.9 operation with a reason that names v1.0", () => {
    expect(
      reasonOf({ version: "v0.9", deleteSurface: { surfaceId: "s1" } }),
    ).toBe('unsupported version "v0.9"; use "v1.0"');
  });

  it("rejects an operation without a version", () => {
    expect(reasonOf({ deleteSurface: { surfaceId: "s1" } })).toBe(
      'operation needs "version":"v1.0"',
    );
  });

  it("rejects ops with zero or several kinds", () => {
    expect(reasonOf({ version: "v1.0" })).toMatch(/exactly one/);
    expect(
      reasonOf({
        version: "v1.0",
        deleteSurface: { surfaceId: "s1" },
        updateDataModel: { surfaceId: "s1", value: 1 },
      }),
    ).toMatch(/exactly one/);
  });
});

describe("validateOperation: createSurface", () => {
  it("accepts a new surface without a catalogId, or with the manifest catalogId", () => {
    expect(reasonOf(create({}))).toBe("ok");
    expect(reasonOf(create({ catalogId: "shop" }))).toBe("ok");
  });

  it("rejects a foreign catalog", () => {
    expect(reasonOf(create({ catalogId: "other" }))).toBe(
      'unknown catalog "other"; leave out catalogId or use "shop"',
    );
  });

  it("rejects a createSurface without a surfaceId", () => {
    expect(
      reasonOf({ version: "v1.0", createSurface: { catalogId: "shop" } }),
    ).toBe("createSurface.surfaceId is required");
  });

  it("rejects an existing surface", () => {
    expect(
      reasonOf({ version: "v1.0", createSurface: { surfaceId: "s1" } }),
    ).toBe('surface "s1" already exists');
  });

  it("rejects a surface id that was created before, also after a delete", () => {
    expect(reasonOf(create({}), { createdSurfaces: new Set(["s2"]) })).toBe(
      'surface id "s2" was used before; use a new surfaceId',
    );
  });

  it("accepts inline components and a data model", () => {
    expect(
      reasonOf(
        create({
          dataModel: { products: [{ name: "Lamp" }] },
          components: [
            {
              id: "root",
              component: "ProductGrid",
              children: { componentId: "c1", path: "/products" },
            },
          ],
        }),
      ),
    ).toBe("ok");
  });

  it("checks inline components like updateComponents", () => {
    expect(
      reasonOf(create({ components: [{ id: "x", component: "Nope" }] })),
    ).toBe('component "x": unknown component "Nope"');
    expect(reasonOf(create({ components: [] }))).toBe(
      "createSurface.components must be a non-empty array",
    );
  });

  it("rejects an inline data model that is not a JSON object", () => {
    for (const dataModel of [[1], "s", null]) {
      expect(reasonOf(create({ dataModel }))).toBe(
        "createSurface.dataModel must be a JSON object",
      );
    }
  });
});

describe("validateOperation: surface updates", () => {
  it("rejects updates to surfaces that do not exist", () => {
    expect(
      reasonOf({
        version: "v1.0",
        updateComponents: {
          surfaceId: "missing",
          components: [{ id: "root", component: "ProductGrid" }],
        },
      }),
    ).toBe('surface "missing" does not exist; send createSurface first');
  });

  it("accepts an update to a known surface that is also in createdSurfaces", () => {
    expect(
      reasonOf(update({ id: "root", component: "ProductGrid" }), {
        createdSurfaces: new Set(["s1"]),
      }),
    ).toBe("ok");
  });

  it("accepts a grid with child references and a card with literal and bound props", () => {
    expect(
      reasonOf(
        update(
          {
            id: "root",
            component: "ProductGrid",
            title: "Picks",
            children: ["c1", "c2"],
          },
          {
            id: "c1",
            component: "ProductCard",
            name: "Headphones",
            price: { "@path": "/prices/c1" },
            onAddToCart: {
              functionCall: { "@call": "addToCart", args: { productId: "p1" } },
            },
          },
        ),
        { functions },
      ),
    ).toBe("ok");
  });

  it("rejects a v0.9 path binding in a data prop with a reason that names @path", () => {
    expect(reasonOf(card({ price: { path: "/prices/c1" } }))).toBe(
      'component "c1": price: bind data with {"@path": "/x"}, not {"path": "/x"}',
    );
  });

  it("rejects unknown components, unknown props and missing required props", () => {
    expect(reasonOf(update({ id: "x", component: "Nope" }))).toMatch(
      /unknown component "Nope"/,
    );
    expect(reasonOf(card({ color: "red" }))).toMatch(/unknown prop "color"/);
    expect(
      reasonOf(update({ id: "c1", component: "ProductCard", name: "A" })),
    ).toMatch(/missing required prop "price"/);
  });

  it("rejects a component without an id", () => {
    expect(reasonOf(update({ component: "ProductGrid" }))).toBe(
      "id is required",
    );
  });

  it("accepts the A2UI component envelope: the own catalogId, accessibility and metadata", () => {
    expect(
      reasonOf(
        card({
          catalogId: "shop",
          accessibility: {
            label: { "@path": "/name" },
            description: {
              "@call": "formatString",
              args: { value: "Adds ${/name}" },
            },
            live: "polite",
            hidden: false,
          },
          metadata: { extensions: { "acme.track": "cart" } },
        }),
      ),
    ).toBe("ok");
    expect(reasonOf(card({ metadata: {} }))).toBe("ok");
  });

  it("rejects an envelope with a foreign catalog, a bad accessibility or malformed metadata", () => {
    expect(reasonOf(card({ catalogId: "other" }))).toBe(
      'component "c1": catalogId: unknown catalog "other"; leave out catalogId or use "shop"',
    );
    expect(reasonOf(card({ accessibility: "x" }))).toMatch(
      /accessibility: must be \{ "label"/,
    );
    expect(reasonOf(card({ accessibility: { role: "img" } }))).toBe(
      'component "c1": accessibility: unknown key "role"',
    );
    expect(reasonOf(card({ accessibility: { live: "loud" } }))).toBe(
      'component "c1": accessibility: live must be one of off, polite, assertive',
    );
    expect(reasonOf(card({ accessibility: { hidden: "yes" } }))).toBe(
      'component "c1": accessibility: hidden must be a boolean',
    );
    expect(reasonOf(card({ accessibility: { label: 1 } }))).toBe(
      'component "c1": accessibility: label must be a string',
    );
    expect(
      reasonOf(card({ accessibility: { label: { path: "/name" } } })),
    ).toBe(
      'component "c1": accessibility: label: bind data with {"@path": "/x"}, not {"path": "/x"}',
    );
    expect(
      reasonOf(card({ accessibility: { label: { "@call": "openUrl" } } })),
    ).toMatch(/accessibility: label: /);
    expect(reasonOf(card({ metadata: { extensions: 1 } }))).toBe(
      'component "c1": metadata must be { "extensions": { ... } }',
    );
  });

  it("rejects slot values that are not id references or reference the node itself", () => {
    expect(
      reasonOf(
        update({ id: "root", component: "ProductGrid", children: "c1" }),
      ),
    ).toMatch(/array/);
    expect(
      reasonOf(
        update({ id: "root", component: "ProductGrid", children: ["root"] }),
      ),
    ).toMatch(/its own child/);
    expect(
      reasonOf(update({ id: "f", component: "Frame", child: ["a"] })),
    ).toMatch(/component ids/);
  });

  it("rejects duplicate ids within one update", () => {
    expect(
      reasonOf(
        update(
          { id: "root", component: "ProductGrid" },
          { id: "root", component: "ProductGrid" },
        ),
      ),
    ).toMatch(/appears twice/);
  });
});

describe("validateOperation: components of the target", () => {
  const allowedComponents = {
    target: "products",
    names: new Set(["ProductGrid", "ProductCard"]),
  };
  const notAllowed =
    '"Frame" is not allowed in target "products"; use one of: ProductGrid, ProductCard';

  it("accepts components of the list in updateComponents and in inline createSurface components", () => {
    const grid = { id: "root", component: "ProductGrid", children: ["c1"] };
    expect(reasonOf(update(grid), { allowedComponents })).toBe("ok");
    expect(
      reasonOf(create({ components: [grid] }), { allowedComponents }),
    ).toBe("ok");
  });

  it("rejects a catalog component that is not in the list, also as a child", () => {
    const frame = { id: "f", component: "Frame" };
    expect(
      reasonOf(update({ id: "root", component: "ProductGrid" }, frame), {
        allowedComponents,
      }),
    ).toBe(`component "f": ${notAllowed}`);
    expect(
      reasonOf(create({ components: [{ ...frame, id: "root" }] }), {
        allowedComponents,
      }),
    ).toBe(`component "root": ${notAllowed}`);
  });

  it("names the unknown component first when it is not in the catalog", () => {
    expect(
      reasonOf(update({ id: "x", component: "Nope" }), { allowedComponents }),
    ).toBe('component "x": unknown component "Nope"');
  });

  it("rejects every component when the list is empty", () => {
    expect(
      reasonOf(update({ id: "root", component: "ProductGrid" }), {
        allowedComponents: { target: "products", names: new Set() },
      }),
    ).toBe(
      'component "root": "ProductGrid" is not allowed in target "products"; use one of: none',
    );
  });
});

describe("validateOperation: templates", () => {
  const templateReason = (children: unknown) =>
    reasonOf(update({ id: "root", component: "ProductGrid", children }));

  it("accepts a template with an absolute or a relative path in a multiple slot", () => {
    for (const path of ["/products", "items/0/variants"]) {
      expect(templateReason({ componentId: "card", path })).toBe("ok");
    }
  });

  it("rejects a template in a single slot", () => {
    expect(
      reasonOf(
        update({
          id: "f",
          component: "Frame",
          child: { componentId: "card", path: "/products" },
        }),
      ),
    ).toBe(
      'component "f": child: a template { "componentId", "path" } is only allowed in a "multiple" slot',
    );
  });

  it("rejects template paths with forbidden or empty segments", () => {
    expect(templateReason({ componentId: "card", path: "/__proto__/x" })).toBe(
      'component "root": children: path segment "__proto__" is not allowed in template path',
    );
    for (const path of ["/", "a//b", "items/"]) {
      expect(templateReason({ componentId: "card", path })).toBe(
        'component "root": children: template path must not contain empty segments',
      );
    }
  });

  it("rejects templates without a component id, with extra keys, or that repeat the node itself", () => {
    expect(templateReason({ componentId: "", path: "/products" })).toMatch(
      /template componentId must be a component id/,
    );
    expect(templateReason({ componentId: "card", path: "" })).toMatch(
      /template path must be a JSON pointer or a relative path/,
    );
    expect(
      templateReason({ componentId: "card", path: "/products", limit: 3 }),
    ).toMatch(/takes only "componentId" and "path"/);
    expect(templateReason({ componentId: "root", path: "/products" })).toMatch(
      /its own child/,
    );
  });
});

describe("validateOperation: data props", () => {
  it("accepts the @index call, with and without an offset", () => {
    expect(reasonOf(card({ price: { "@call": "@index" } }))).toBe("ok");
    expect(
      reasonOf(card({ price: { "@call": "@index", args: { offset: 1 } } })),
    ).toBe("ok");
  });

  it("accepts calc and series, the CopilotKit value functions", () => {
    expect(
      reasonOf(
        card({
          name: {
            "@call": "calc",
            args: { expression: "seats * 29", seats: { "@path": "/seats" } },
          },
        }),
      ),
    ).toBe("ok");
    expect(
      reasonOf(
        card({
          name: { "@call": "series", args: { count: 3, item: { n: "${i}" } } },
        }),
      ),
    ).toBe("ok");
  });

  it("accepts a basic function value, also nested and with bound args", () => {
    expect(
      reasonOf(
        card({
          name: {
            "@call": "formatCurrency",
            args: { value: { "@path": "/price" }, currency: "EUR" },
          },
        }),
      ),
    ).toBe("ok");
    expect(
      reasonOf(
        card({
          name: [
            { label: { "@call": "formatString", args: { value: "${/n}" } } },
          ],
        }),
      ),
    ).toBe("ok");
  });

  it("rejects every other function call in a data prop", () => {
    const prefix = 'component "c1": name: ';
    const suffix =
      "; a data prop can call only @index and the built-in functions (";
    const cases: Array<[unknown, string]> = [
      [
        { "@call": "formatPrice", args: {} },
        '"formatPrice" is not a basic function',
      ],
      [
        { "@call": "@index", args: { offset: "1" } },
        "@index takes only an offset",
      ],
      [
        [{ label: { "@call": "formatPrice" } }],
        '"formatPrice" is not a basic function',
      ],
      [
        { call: "addToCart", args: {} },
        'name the function with "@call", not "call"',
      ],
      [
        { "@call": "openUrl", args: { url: "https://x" } },
        '"openUrl" runs only from an event',
      ],
      [
        { "@call": "formatNumber", args: [1] },
        'the args of "formatNumber" must be an object',
      ],
      [
        { nested: { functionCall: { "@call": "addToCart" } } },
        "an event binding is not a value",
      ],
    ];
    for (const [name, reason] of cases) {
      expect(reasonOf(card({ name }))).toContain(prefix + reason + suffix);
    }
  });
});

describe("validateOperation: typed child references", () => {
  const tabs = (tabs: unknown) => update({ id: "t1", component: "Tabs", tabs });

  it("accepts component ids at a nested reference", () => {
    expect(
      reasonOf(
        tabs([
          { title: "A", child: "a" },
          { title: "B", child: "b" },
        ]),
      ),
    ).toBe("ok");
    // A bound list is checked at render.
    expect(reasonOf(tabs({ "@path": "/tabs" }))).toBe("ok");
  });

  it("accepts a bound id at an array position of a reference", () => {
    expect(reasonOf(tabs([{ title: "A", child: { "@path": "/panel" } }]))).toBe(
      "ok",
    );
    expect(reasonOf(tabs([{ "@path": "/tab" }]))).toBe("ok");
  });

  it("rejects a value that is not an id, and the component itself", () => {
    expect(reasonOf(tabs([{ title: "A", child: 1 }]))).toBe(
      'component "t1": tabs.child: must reference component ids (strings)',
    );
    expect(reasonOf(tabs([{ title: "A", child: "t1" }]))).toBe(
      'component "t1": tabs.child: a component cannot be its own child',
    );
  });
});

describe("validateOperation: event bindings", () => {
  const eventReason = (event: unknown) =>
    reasonOf(card({ onAddToCart: { event } }));

  it("accepts an event with a userMessage string or binding, and a bound context", () => {
    expect(
      eventReason({
        name: "choose",
        userMessage: "I pick the Team plan",
        context: { seats: { "@path": "/seats" }, plan: "team" },
      }),
    ).toBe("ok");
    expect(
      eventReason({ name: "choose", userMessage: { "@path": "/message" } }),
    ).toBe("ok");
  });

  it("rejects an event without a name, and a binding that is not an action", () => {
    expect(eventReason({})).toBe(
      'component "c1": onAddToCart: event.name is required',
    );
    expect(reasonOf(card({ onAddToCart: "addToCart" }))).toMatch(
      /action object/,
    );
  });

  it("rejects a userMessage that is not a string or a binding", () => {
    expect(eventReason({ name: "choose", userMessage: 5 })).toBe(
      'component "c1": onAddToCart: event.userMessage must be a string, {"@path": "/x"} or a function value',
    );
  });

  it("rejects v0.9 path bindings in userMessage and context with a reason that names @path", () => {
    expect(eventReason({ name: "choose", userMessage: { path: "/m" } })).toBe(
      'component "c1": onAddToCart: event.userMessage: bind data with {"@path": "/x"}, not {"path": "/x"}',
    );
    expect(
      eventReason({ name: "choose", context: { seats: { path: "/seats" } } }),
    ).toBe(
      'component "c1": onAddToCart: event.context.seats: bind data with {"@path": "/x"}, not {"path": "/x"}',
    );
  });

  it("accepts a function value as the userMessage", () => {
    expect(
      eventReason({
        name: "choose",
        userMessage: { "@call": "formatString", args: { value: "Pick ${/n}" } },
      }),
    ).toBe("ok");
    expect(eventReason({ name: "choose", userMessage: 1 })).toBe(
      'component "c1": onAddToCart: event.userMessage must be a string, {"@path": "/x"} or a function value',
    );
  });

  it("accepts @index and a basic function in the event context, but not an app function", () => {
    expect(
      eventReason({ name: "choose", context: { row: { "@call": "@index" } } }),
    ).toBe("ok");
    expect(
      eventReason({
        name: "choose",
        context: {
          label: { "@call": "formatString", args: { value: "${/name}" } },
        },
      }),
    ).toBe("ok");
    expect(
      eventReason({
        name: "choose",
        context: { row: { "@call": "addToCart" } },
      }),
    ).toContain(
      'component "c1": onAddToCart: event.context.row: "addToCart" is not a basic function',
    );
  });
});

describe("validateOperation: function-call bindings", () => {
  const callReason = (
    functionCall: unknown,
    options?: Partial<ValidateOperationOptions>,
  ) => reasonOf(card({ onAddToCart: { functionCall } }), options);

  it("checks function names only when the function list is provided", () => {
    const call = { "@call": "removeFromCart" };
    expect(callReason(call, { functions })).toBe(
      'component "c1": onAddToCart: function "removeFromCart" is not exposed to generative UI',
    );
    expect(callReason(call)).toBe("ok");
  });

  it("accepts a basic function in an event binding without a declaration", () => {
    expect(
      callReason(
        { "@call": "openUrl", args: { url: "https://example.com" } },
        { functions },
      ),
    ).toBe("ok");
  });

  it("does not expose inherited Object.prototype keys as functions", () => {
    expect(callReason({ "@call": "toString" }, { functions })).toMatch(
      /function "toString" is not exposed/,
    );
  });

  it("names @call when the model writes the v0.9 call key", () => {
    expect(callReason({ call: "addToCart" })).toBe(
      'component "c1": onAddToCart: functionCall names the function with "@call", not "call"',
    );
  });

  it("rejects args that are not an object, or that hold a v0.9 path binding", () => {
    expect(callReason({ "@call": "addToCart", args: [1] })).toBe(
      'component "c1": onAddToCart: functionCall.args must be an object',
    );
    expect(
      callReason({ "@call": "addToCart", args: { id: { path: "/id" } } }),
    ).toBe(
      'component "c1": onAddToCart: functionCall.args.id: bind data with {"@path": "/x"}, not {"path": "/x"}',
    );
  });
});

describe("validateOperation: updateDataModel", () => {
  it("requires a value and names null for a delete", () => {
    expect(reasonOf(setData({ path: "/a" }))).toBe(
      'updateDataModel.value is required; use "value":null to delete',
    );
  });

  it("accepts null to delete the key at a path", () => {
    expect(reasonOf(setData({ path: "/cart/item", value: null }))).toBe("ok");
  });

  it("accepts writes under /app like any other data-model path", () => {
    expect(reasonOf(setData({ path: "/app/cart", value: 1 }))).toBe("ok");
    expect(reasonOf(setData({ path: "/", value: { app: {} } }))).toBe("ok");
  });

  it("rejects prototype-polluting path segments", () => {
    for (const path of [
      "/__proto__/x",
      "/a/constructor/b",
      "/prototype",
      "/a/~0/__proto__",
    ]) {
      expect(reasonOf(setData({ path, value: 1 }))).toMatch(/not allowed/);
    }
  });

  it("rejects empty path segments", () => {
    for (const path of ["//a/b", "/a//b", "/a/"]) {
      expect(reasonOf(setData({ path, value: 1 }))).toMatch(/empty segments/);
    }
  });

  it("rejects root writes whose value is not a JSON object", () => {
    for (const value of [5, [1], "s", null]) {
      expect(reasonOf(setData({ path: "/", value }))).toBe(
        "a root updateDataModel value must be a JSON object",
      );
      expect(reasonOf(setData({ value }))).toBe(
        "a root updateDataModel value must be a JSON object",
      );
    }
    expect(reasonOf(setData({ value: { items: [] } }))).toBe("ok");
  });
});

describe("validateOperation: callRendererFunction", () => {
  it("accepts a call of a declared function, with no surface", () => {
    expect(
      reasonOf(
        callFunction({
          callFunction: { "@call": "addToCart", args: { productId: "p1" } },
        }),
        { functions, knownSurfaces: new Set() },
      ),
    ).toBe("ok");
  });

  it("requires a non-empty functionCallId", () => {
    for (const functionCallId of [undefined, "", 7]) {
      expect(
        reasonOf(
          callFunction({
            functionCallId,
            callFunction: { "@call": "addToCart" },
          }),
        ),
      ).toBe("callRendererFunction.functionCallId must be a non-empty string");
    }
  });

  it("leaves the openUrl restriction to the dispatcher when the app functions are not known", () => {
    expect(
      reasonOf(
        callFunction({
          callFunction: { "@call": "openUrl", args: { url: "https://x" } },
        }),
      ),
    ).toBe("ok");
  });

  it("lets the agent call an openUrl that the app declared itself", () => {
    expect(
      reasonOf(
        callFunction({
          callFunction: { "@call": "openUrl", args: { url: "https://x" } },
        }),
        { functions: { openUrl: { parameters: { type: "object" } } } },
      ),
    ).toBe("ok");
  });

  it("refuses a user-gesture function and every other built-in from the agent: they are value functions of the UI", () => {
    expect(
      reasonOf(
        callFunction({
          callFunction: { "@call": "openUrl", args: { url: "https://x" } },
        }),
        { functions },
      ),
    ).toBe(
      'function "openUrl" runs only from a user gesture; the agent cannot call it',
    );
    expect(
      reasonOf(
        callFunction({
          callFunction: { "@call": "formatNumber", args: { value: 1 } },
        }),
        { functions },
      ),
    ).toBe(
      'function "formatNumber" runs only in the UI (allowedCallers "rendererOnly"); the agent cannot call it',
    );
  });

  it("applies the allowedCallers of an app function, to the agent and to event bindings", () => {
    const permissions = {
      ...functions,
      track: {
        parameters: { type: "object" },
        allowedCallers: "rendererOnly" as const,
      },
      reload: {
        parameters: { type: "object" },
        allowedCallers: "agentOnly" as const,
      },
      share: {
        parameters: { type: "object" },
        requiresUserActivation: true,
      },
    };
    const agentCall = (name: string) =>
      reasonOf(callFunction({ callFunction: { "@call": name } }), {
        functions: permissions,
      });
    expect(agentCall("addToCart")).toBe("ok");
    expect(agentCall("reload")).toBe("ok");
    expect(agentCall("track")).toBe(
      'function "track" runs only in the UI (allowedCallers "rendererOnly"); the agent cannot call it',
    );
    expect(agentCall("share")).toBe(
      'function "share" runs only from a user gesture; the agent cannot call it',
    );
    const binding = (name: string) =>
      reasonOf(card({ onAddToCart: { functionCall: { "@call": name } } }), {
        functions: permissions,
      });
    expect(binding("track")).toBe("ok");
    expect(binding("share")).toBe("ok");
    expect(binding("reload")).toBe(
      'component "c1": onAddToCart: function "reload" runs only for the agent (allowedCallers "agentOnly"); the UI cannot call it',
    );
  });

  it("requires a function name in @call", () => {
    expect(reasonOf(callFunction({ callFunction: {} }))).toBe(
      'callRendererFunction.callFunction["@call"] must be a function name',
    );
    expect(reasonOf(callFunction({}))).toBe(
      'callRendererFunction.callFunction must be { "@call": "<function>", "args": { ... } }',
    );
  });

  it("rejects an undeclared function when the function list is provided", () => {
    const op = callFunction({ callFunction: { "@call": "removeFromCart" } });
    expect(reasonOf(op, { functions })).toBe(
      'function "removeFromCart" is not exposed to generative UI',
    );
    expect(reasonOf(op)).toBe("ok");
  });

  it("rejects args that are not an object and a foreign catalog", () => {
    expect(
      reasonOf(
        callFunction({ callFunction: { "@call": "addToCart", args: 1 } }),
      ),
    ).toBe("callRendererFunction.callFunction.args must be an object");
    expect(
      reasonOf(
        callFunction({
          callFunction: { "@call": "addToCart", catalogId: "other" },
        }),
      ),
    ).toBe(
      'callRendererFunction.callFunction: unknown catalog "other"; leave out catalogId or use "shop"',
    );
  });

  it("has a kind but no surface id", () => {
    const op = callFunction({ callFunction: { "@call": "addToCart" } });
    expect(getOperationKind(op)).toBe("callRendererFunction");
    expect(getOperationSurfaceId(op)).toBeUndefined();
  });
});

describe("validateOperation: Object.prototype keys", () => {
  it("rejects component types that only exist on Object.prototype without throwing", () => {
    expect(() =>
      reasonOf(update({ id: "x", component: "constructor" })),
    ).not.toThrow();
    expect(reasonOf(update({ id: "x", component: "constructor" }))).toMatch(
      /unknown component "constructor"/,
    );
    expect(reasonOf(update({ id: "x", component: "__proto__" }))).toMatch(
      /unknown component "__proto__"/,
    );
  });

  it("does not treat an inherited Object.prototype key as an event prop", () => {
    expect(reasonOf(card({ toString: "x" }))).toMatch(
      /unknown prop "toString"/,
    );
  });

  it("does not treat an inherited Object.prototype key as a slot", () => {
    expect(
      reasonOf(
        update({ id: "root", component: "ProductGrid", constructor: ["c1"] }),
      ),
    ).toMatch(/unknown prop "constructor"/);
  });
});

describe("isPathBinding", () => {
  it("accepts only an object with a single @path string", () => {
    expect(isPathBinding({ "@path": "/a" })).toBe(true);
    expect(isPathBinding({ path: "/a" })).toBe(false);
    expect(isPathBinding({ "@path": "/a", label: "x" })).toBe(false);
    expect(isPathBinding({ "@path": 1 })).toBe(false);
  });
});

describe("isIndexCall", () => {
  it("accepts @index with no args or a numeric offset", () => {
    expect(isIndexCall({ "@call": "@index" })).toBe(true);
    expect(isIndexCall({ "@call": "@index", args: { offset: 1 } })).toBe(true);
    expect(isIndexCall({ "@call": "@index", args: {} })).toBe(true);
  });

  it("rejects other calls, a non-numeric offset, and extra keys", () => {
    expect(isIndexCall({ "@call": "formatPrice" })).toBe(false);
    expect(isIndexCall({ "@call": "@index", args: { offset: "1" } })).toBe(
      false,
    );
    expect(isIndexCall({ "@call": "@index", args: { step: 2 } })).toBe(false);
    expect(isIndexCall({ "@call": "@index", extra: true })).toBe(false);
  });
});
