import { describe, expect, it } from "vitest";
import {
  extractCompleteArrayItems,
  extractFenceOperations,
  extractStringField,
  getMarkdownOperationSurfaceId,
  prepareSurfaceOperations,
  classifySurfaceCards,
  flattenInformationalCards,
  segmentSurfaceProse,
} from "../a2ui-markdown";
import type { A2UIMarkdownOperation } from "../a2ui-markdown";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Every component of every updateComponents operation, in order. */
function componentsOf(ops: A2UIMarkdownOperation[]) {
  return ops.flatMap((op) => {
    const update = op.updateComponents;
    if (!isObject(update) || !Array.isArray(update.components)) return [];
    return update.components.filter(isObject);
  });
}

const CREATE =
  '{"version":"v1.0","createSurface":{"surfaceId":"plan","catalogId":"cat"}}';
const UPDATE =
  '{"version":"v1.0","updateComponents":{"surfaceId":"plan","components":[{"id":"root","component":"Column","children":["t"]},{"id":"t","component":"Text","text":"hi"}]}}';
const DATA =
  '{"version":"v1.0","updateDataModel":{"surfaceId":"plan","path":"/","value":{"seats":8}}}';
const CALL =
  '{"version":"v1.0","callRendererFunction":{"functionCallId":"f1","callFunction":{"@call":"addToCart","args":{"productId":"p1"}}}}';
const ADD_TO_CART = {
  version: "v1.0",
  callRendererFunction: {
    functionCallId: "f1",
    callFunction: { "@call": "addToCart", args: { productId: "p1" } },
  },
};
const OPEN_CART = {
  version: "v1.0",
  callRendererFunction: {
    functionCallId: "f2",
    callFunction: { "@call": "openCart" },
  },
};

/** `prepareSurfaceOperations` with fallback surface "f" and catalog "cat". */
function prepare(
  operations: A2UIMarkdownOperation[],
  overrides?: { fallbackSurfaceId?: string; catalogId?: string },
) {
  return prepareSurfaceOperations({
    operations,
    fallbackSurfaceId: "f",
    catalogId: "cat",
    ...overrides,
  });
}

describe("extractStringField", () => {
  it("reads a string field from partial JSON", () => {
    expect(
      extractStringField(
        '{"version":"v1.0","createSurface":{"surfaceId":"plan","cat',
        "surfaceId",
      ),
    ).toBe("plan");
  });
  it("returns null when the string is not closed yet", () => {
    expect(
      extractStringField('{"createSurface":{"surfaceId":"pl', "surfaceId"),
    ).toBeNull();
  });
  it("ignores escaped quotes inside strings", () => {
    expect(extractStringField('{"surfaceId":"a\\"b"}', "surfaceId")).toBe(
      'a"b',
    );
  });
});

describe("extractCompleteArrayItems", () => {
  it("returns complete objects and closed=false while the array is open", () => {
    const partial =
      '{"updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Column","children":["a"]},{"id":"a","comp';
    expect(extractCompleteArrayItems(partial, "components")).toEqual({
      items: [{ id: "root", component: "Column", children: ["a"] }],
      closed: false,
    });
  });
  it("returns closed=true once the array closes", () => {
    const partial =
      '{"updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"x"}]}';
    expect(extractCompleteArrayItems(partial, "components")).toEqual({
      items: [{ id: "root", component: "Text", text: "x" }],
      closed: true,
    });
  });
  it("handles brackets and braces inside strings", () => {
    const partial =
      '{"components":[{"id":"root","component":"Text","text":"a } ] b"},{"id":"x"';
    expect(extractCompleteArrayItems(partial, "components")!.items).toEqual([
      { id: "root", component: "Text", text: "a } ] b" },
    ]);
  });
  it("returns null when the key is absent", () => {
    expect(extractCompleteArrayItems('{"foo":1', "components")).toBeNull();
  });
});

describe("extractFenceOperations", () => {
  it("parses complete lines", () => {
    const res = extractFenceOperations(`${CREATE}\n${UPDATE}\n${DATA}\n`);
    expect(res.operations).toHaveLength(3);
    expect(res.partialLine).toBeNull();
    expect(res.invalidLines).toEqual([]);
  });
  it("emits a partial updateComponents with the complete components so far", () => {
    const partial = UPDATE.slice(0, UPDATE.indexOf('{"id":"t"') + 5);
    const res = extractFenceOperations(`${CREATE}\n${partial}`);
    expect(res.operations).toHaveLength(2);
    expect(res.operations[1]).toEqual({
      version: "v1.0",
      updateComponents: {
        surfaceId: "plan",
        components: [{ id: "root", component: "Column", children: ["t"] }],
      },
    });
    expect(res.partialLine).toBe(partial);
  });
  it("emits nothing for a partial line without complete components", () => {
    const res = extractFenceOperations(
      `${CREATE}\n{"version":"v1.0","updateComponents":{"surfaceId":"plan","components":[{"id":"ro`,
    );
    expect(res.operations).toHaveLength(1);
  });
  it("emits a partial createSurface once the surfaceId string is complete", () => {
    const res = extractFenceOperations(
      '{"version":"v1.0","createSurface":{"surfaceId":"plan","catalogI',
    );
    expect(res.operations).toEqual([
      { version: "v1.0", createSurface: { surfaceId: "plan" } },
    ]);
  });
  it("records invalid complete lines and keeps going", () => {
    const res = extractFenceOperations(`not json\n${CREATE}\n`);
    expect(res.invalidLines).toEqual(["not json"]);
    expect(res.operations).toHaveLength(1);
  });
  it("skips blank lines", () => {
    expect(extractFenceOperations(`\n${CREATE}\n\n`).operations).toHaveLength(
      1,
    );
  });
});

describe("prepareSurfaceOperations", () => {
  it("uses the surfaceId from the operations", () => {
    const res = prepare([JSON.parse(CREATE), JSON.parse(UPDATE)], {
      fallbackSurfaceId: "m1-0",
    });
    expect(res.surfaceId).toBe("plan");
    expect(res.operations).toHaveLength(2);
  });
  it("synthesizes createSurface and fills missing surfaceIds from the fallback", () => {
    const op = {
      updateComponents: {
        components: [{ id: "root", component: "Text", text: "x" }],
      },
    };
    const res = prepare([op], { fallbackSurfaceId: "m1-0" });
    expect(res.surfaceId).toBe("m1-0");
    expect(res.operations[0]).toEqual({
      version: "v1.0",
      createSurface: { surfaceId: "m1-0", catalogId: "cat" },
    });
    expect(res.operations[1]).toEqual({
      version: "v1.0",
      updateComponents: {
        surfaceId: "m1-0",
        components: op.updateComponents.components,
      },
    });
  });
  it("adds version v1.0 when missing", () => {
    const res = prepare([{ createSurface: { surfaceId: "a" } }]);
    expect(res.operations[0]).toEqual({
      version: "v1.0",
      createSurface: { surfaceId: "a", catalogId: "cat" },
    });
  });
});

describe("getMarkdownOperationSurfaceId", () => {
  it("reads nested and top-level surfaceIds", () => {
    expect(
      getMarkdownOperationSurfaceId({ updateDataModel: { surfaceId: "x" } }),
    ).toBe("x");
    expect(getMarkdownOperationSurfaceId({ surfaceId: "y" })).toBe("y");
    expect(getMarkdownOperationSurfaceId({ foo: 1 })).toBeUndefined();
  });
  it("gives a function call no surfaceId, even with a top-level one", () => {
    expect(
      getMarkdownOperationSurfaceId({ surfaceId: "y", ...JSON.parse(CALL) }),
    ).toBeUndefined();
  });
});

describe("extractFenceOperations trailing line", () => {
  it("treats a complete JSON trailing line without newline as a complete operation", () => {
    const res = extractFenceOperations(`${CREATE}\n${DATA}`);
    expect(res.operations).toEqual([JSON.parse(CREATE), JSON.parse(DATA)]);
    expect(res.partialLine).toBeNull();
  });
});

describe("prepareSurfaceOperations createSurface handling", () => {
  it("keeps only the first createSurface", () => {
    const res = prepare([
      JSON.parse(CREATE),
      JSON.parse(UPDATE),
      JSON.parse(CREATE),
      JSON.parse(DATA),
    ]);
    expect(res.operations.filter((op) => "createSurface" in op)).toHaveLength(
      1,
    );
    expect(res.operations[0]).toHaveProperty("createSurface");
    expect(res.operations).toHaveLength(3);
  });
  it("always uses the client-provided catalogId", () => {
    const res = prepare(
      [{ createSurface: { surfaceId: "a", catalogId: "model-made-this-up" } }],
      { catalogId: "client-cat" },
    );
    expect(res.operations[0]).toEqual({
      version: "v1.0",
      createSurface: { surfaceId: "a", catalogId: "client-cat" },
    });
  });
});

describe("prepareSurfaceOperations function calls", () => {
  it("returns function calls in order, apart from the surface operations", () => {
    const res = prepare([
      JSON.parse(CREATE),
      JSON.parse(CALL),
      JSON.parse(UPDATE),
      { callRendererFunction: OPEN_CART.callRendererFunction },
    ]);
    expect(res.surfaceId).toBe("plan");
    expect(res.operations).toEqual([
      {
        version: "v1.0",
        createSurface: { surfaceId: "plan", catalogId: "cat" },
      },
      JSON.parse(UPDATE),
    ]);
    expect(res.functionCalls).toEqual([ADD_TO_CART, OPEN_CART]);
  });
  it("creates no surface for a fence that only calls functions", () => {
    expect(prepare([JSON.parse(CALL)])).toEqual({
      surfaceId: "f",
      operations: [],
      functionCalls: [ADD_TO_CART],
    });
  });
});

describe("extractFenceOperations v1.0 streaming", () => {
  it("starts a new operation at a function-call line after an unbalanced one", () => {
    const missingBrace = DATA.slice(0, -1);
    const call = `{"callRendererFunction":${JSON.stringify(ADD_TO_CART.callRendererFunction)}}`;
    const res = extractFenceOperations(`${missingBrace}\n${call}\n`);
    expect(res.operations).toEqual([
      {
        version: "v1.0",
        updateDataModel: { surfaceId: "plan", path: "/", value: { seats: 8 } },
      },
      { callRendererFunction: ADD_TO_CART.callRendererFunction },
    ]);
    expect(res.invalidLines).toEqual([missingBrace]);
  });
  it("emits the complete components and data model of a streaming createSurface", () => {
    const res = extractFenceOperations(
      '{"version":"v1.0","createSurface":{"surfaceId":"plan","dataModel":{"seats":10},"components":[{"id":"root","component":"Column","children":["seats"]},{"id":"seats","comp',
    );
    expect(res.operations).toEqual([
      {
        version: "v1.0",
        createSurface: {
          surfaceId: "plan",
          dataModel: { seats: 10 },
          components: [
            { id: "root", component: "Column", children: ["seats"] },
          ],
        },
      },
    ]);
  });
  it("leaves out a createSurface data model that is still streaming", () => {
    const res = extractFenceOperations(
      '{"version":"v1.0","createSurface":{"surfaceId":"plan","dataModel":{"seats":10,"na',
    );
    expect(res.operations).toEqual([
      { version: "v1.0", createSurface: { surfaceId: "plan" } },
    ]);
  });
  it("emits nothing for a function call that is still streaming", () => {
    const res = extractFenceOperations(CALL.slice(0, CALL.indexOf('"p1"') + 2));
    expect(res.operations).toEqual([]);
  });
});

describe("extractFenceOperations partial updateDataModel", () => {
  it("emits the complete array items of a streaming value", () => {
    const res = extractFenceOperations(
      '{"version":"v1.0","updateDataModel":{"surfaceId":"s","path":"/","value":{"rows":[{"a":1},{"a":2}',
    );
    expect(res.operations).toEqual([
      {
        version: "v1.0",
        updateDataModel: {
          surfaceId: "s",
          path: "/",
          value: { rows: [{ a: 1 }, { a: 2 }] },
        },
      },
    ]);
  });
  it("emits a complete value object while the line is still open", () => {
    const res = extractFenceOperations(
      '{"version":"v1.0","updateDataModel":{"surfaceId":"s","path":"/","value":{"seats":8}',
    );
    expect(res.operations).toEqual([
      {
        version: "v1.0",
        updateDataModel: { surfaceId: "s", path: "/", value: { seats: 8 } },
      },
    ]);
  });
  it("keeps complete scalars next to a streaming array", () => {
    const res = extractFenceOperations(
      '{"updateDataModel":{"surfaceId":"s","value":{"title":"T","rows":[{"a":1},{"a"',
    );
    expect(res.operations[0]).toEqual({
      version: "v1.0",
      updateDataModel: {
        surfaceId: "s",
        value: { title: "T", rows: [{ a: 1 }] },
      },
    });
  });
  it("emits nothing until some value content is complete", () => {
    expect(
      extractFenceOperations(
        '{"version":"v1.0","updateDataModel":{"surfaceId":"s","path":"/","value":{"rows":[{"a":1',
      ).operations,
    ).toEqual([]);
    expect(
      extractFenceOperations(
        '{"version":"v1.0","updateDataModel":{"surfaceId":"s","path":"/"',
      ).operations,
    ).toEqual([]);
  });
});

describe("extractFenceOperations partial field scoping", () => {
  it("does not read surfaceId or version from inside components", () => {
    const res = extractFenceOperations(
      '{"updateComponents":{"components":[{"id":"root","component":"Text","surfaceId":"inner","version":"zzz","text":"x"},{"id":"y',
    );
    expect(res.operations).toEqual([
      {
        version: "v1.0",
        updateComponents: {
          components: [
            {
              id: "root",
              component: "Text",
              surfaceId: "inner",
              version: "zzz",
              text: "x",
            },
          ],
        },
      },
    ]);
  });
  it("does not read surfaceId from inside an updateDataModel value", () => {
    const res = extractFenceOperations(
      '{"updateDataModel":{"value":{"surfaceId":"inner","rows":[1,2,',
    );
    expect(res.operations[0]).toEqual({
      version: "v1.0",
      updateDataModel: { value: { surfaceId: "inner", rows: [1, 2] } },
    });
  });
  it("finds a surfaceId written after components once its string closes", () => {
    const head =
      '{"version":"v1.0","updateComponents":{"components":[{"id":"root","component":"Text","text":"x"}],"surfaceId":"pl';
    expect(extractFenceOperations(head).operations[0]).not.toHaveProperty(
      "updateComponents.surfaceId",
    );
    expect(extractFenceOperations(head + 'an"').operations[0]).toHaveProperty(
      "updateComponents.surfaceId",
      "plan",
    );
  });
});

describe("extractFenceOperations object stream", () => {
  const COMPONENTS = [
    { id: "root", component: "Column", children: ["t"] },
    { id: "t", component: "Text", text: "hi" },
  ];
  const PRETTY = [
    '{"version":"v1.0","updateComponents":{"surfaceId":"plan","components":[',
    '  {"id":"root","component":"Column","children":["t"]},',
    '  {"id":"t","component":"Text","text":"hi"}',
    "]}}",
  ].join("\n");

  it("parses an operation pretty-printed over several lines", () => {
    const res = extractFenceOperations(`${CREATE}\n${PRETTY}\n${DATA}\n`);
    expect(res.operations).toEqual([
      JSON.parse(CREATE),
      JSON.parse(UPDATE),
      JSON.parse(DATA),
    ]);
    expect(res.invalidLines).toEqual([]);
    expect(res.recovered).toEqual([]);
    expect(res.partialObject).toBeNull();
  });

  it("parses several objects on one line and ignores commas between them", () => {
    const res = extractFenceOperations(`${CREATE}, ${UPDATE},\n${DATA}`);
    expect(res.operations).toHaveLength(3);
    expect(res.invalidLines).toEqual([]);
  });

  it("flattens a top-level array of operations", () => {
    const res = extractFenceOperations(`[${CREATE},\n${UPDATE}]\n`);
    expect(res.operations).toEqual([JSON.parse(CREATE), JSON.parse(UPDATE)]);
    expect(res.invalidLines).toEqual([]);
  });

  it("emits complete components of a pretty-printed operation while it streams", () => {
    const cut = PRETTY.indexOf('{"id":"t"') + 4;
    const res = extractFenceOperations(`${CREATE}\n${PRETTY.slice(0, cut)}`);
    expect(res.operations[1]).toEqual({
      version: "v1.0",
      updateComponents: { surfaceId: "plan", components: [COMPONENTS[0]] },
    });
    expect(res.partialObject).toBe(PRETTY.slice(0, cut));
    expect(res.partialLine).toBe(res.partialObject);
  });

  it("skips junk between objects and reports it", () => {
    const res = extractFenceOperations(`${CREATE}\n"\n${UPDATE}\n`);
    expect(res.operations).toEqual([JSON.parse(CREATE), JSON.parse(UPDATE)]);
    expect(res.recovered).toEqual(['"']);
    expect(res.invalidLines).toEqual(['"']);
  });

  it("salvages the components of a closed object with a stray quote", () => {
    const broken = UPDATE.replace(/\]\}\}$/, '"]}}');
    const res = extractFenceOperations(`${CREATE}\n${broken}\n${DATA}\n`);
    expect(res.operations).toEqual([
      JSON.parse(CREATE),
      {
        version: "v1.0",
        updateComponents: { surfaceId: "plan", components: COMPONENTS },
      },
      JSON.parse(DATA),
    ]);
    expect(res.invalidLines).toEqual([broken]);
  });

  it("salvages a balanced object that does not parse", () => {
    const broken =
      '{"version":"v1.0","updateComponents":{"surfaceId":"plan","components":[{"id":"root","component":"Text","text":"x"},{"id":"y" "bad"}]}}';
    const res = extractFenceOperations(`${broken}\n`);
    expect(res.operations).toEqual([
      {
        version: "v1.0",
        updateComponents: {
          surfaceId: "plan",
          components: [{ id: "root", component: "Text", text: "x" }],
        },
      },
    ]);
    expect(res.invalidLines).toEqual([broken]);
  });

  it("starts a new operation when an unbalanced one is followed by another", () => {
    const missingBrace = DATA.slice(0, -1);
    const res = extractFenceOperations(`${missingBrace}\n${UPDATE}\n`);
    expect(res.operations).toEqual([
      {
        version: "v1.0",
        updateDataModel: { surfaceId: "plan", path: "/", value: { seats: 8 } },
      },
      JSON.parse(UPDATE),
    ]);
    expect(res.invalidLines).toEqual([missingBrace]);
  });

  it("recovers a trailing object that never balanced", () => {
    const missingBrace = DATA.slice(0, -1);
    const res = extractFenceOperations(`${CREATE}\n${missingBrace}\n`);
    expect(res.operations[1]).toEqual({
      version: "v1.0",
      updateDataModel: { surfaceId: "plan", path: "/", value: { seats: 8 } },
    });
    expect(res.partialObject).toBe(`${missingBrace}\n`);
  });
});

describe("extractCompleteArrayItems component repair", () => {
  const wrap = (items: string) => `{"components":[${items}]}`;

  it("lifts children out of an action missing a closing brace", () => {
    const json = wrap(
      '{"id":"form","component":"Form","action":{"event":{"name":"submit","context":{"message":"x"}},"children":["a","b"]},{"id":"a","component":"Text","text":"A"},{"id":"b","component":"Text","text":"B"}',
    );
    const result = extractCompleteArrayItems(json, "components");
    expect(result?.items).toEqual([
      {
        id: "form",
        component: "Form",
        action: { event: { name: "submit", context: { message: "x" } } },
        children: ["a", "b"],
      },
      { id: "a", component: "Text", text: "A" },
      { id: "b", component: "Text", text: "B" },
    ]);
  });

  it("leaves structural-looking keys inside arrays and non-structural keys alone", () => {
    const item = {
      id: "pick",
      component: "ChoicePicker",
      options: [{ id: "o1", name: "One", children: ["x"] }],
      action: {
        event: {
          name: "pick",
          context: { name: { path: "/n" }, list: [{ id: "x", child: "y" }] },
        },
      },
    };
    const result = extractCompleteArrayItems(
      wrap(JSON.stringify(item)),
      "components",
    );
    expect(result?.items).toEqual([item]);
  });

  it("does not lift a structural key the component already has", () => {
    const item = {
      id: "btn",
      component: "Button",
      child: "label",
      action: { event: { name: "go", context: { id: "plan-pro" } } },
    };
    const result = extractCompleteArrayItems(
      wrap(JSON.stringify(item)),
      "components",
    );
    expect(result?.items).toEqual([item]);
  });

  it("cuts an unbalanced item at the next component and keeps the rest", () => {
    // "bad" never closes its "x" object; the cut item cannot be repaired
    // into valid JSON (dangling key), but later items survive.
    const json = wrap(
      '{"id":"bad","component":"Text","x":{"y":1,"z":},{"id":"ok","component":"Text","text":"ok"},{"id":"ok2","component":"Text","text":"ok2"}',
    );
    const result = extractCompleteArrayItems(json, "components");
    expect(result?.items).toEqual([
      { id: "ok", component: "Text", text: "ok" },
      { id: "ok2", component: "Text", text: "ok2" },
    ]);
    expect(result?.closed).toBe(true);
  });

  it("keeps a cut item when closing it makes it valid", () => {
    const json = wrap(
      '{"id":"card","component":"Card","style":{"pad":2,{"id":"next","component":"Text","text":"n"}',
    );
    const result = extractCompleteArrayItems(json, "components");
    expect(result?.items).toEqual([
      { id: "card", component: "Card", style: { pad: 2 } },
      { id: "next", component: "Text", text: "n" },
    ]);
  });

  it("does not repair arrays other than components", () => {
    const json = '{"rows":[{"a":{"b":1,"children":[1]},{"a":2}]}';
    expect(extractCompleteArrayItems(json, "rows")?.items).toEqual([]);
  });

  it("repairs components when salvaging a malformed fence object", () => {
    const fence = `{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Column","children":["form"]},{"id":"form","component":"Form","action":{"event":{"name":"submit","context":{"message":"x"}},"children":["a"]},{"id":"a","component":"Text","text":"A"}]}}`;
    const { operations } = extractFenceOperations(fence);
    const components = componentsOf(operations);
    expect(components.map((c) => c.id)).toEqual(["root", "form", "a"]);
    expect(components[1]).toHaveProperty("children", ["a"]);
  });
});

describe("classifySurfaceCards / flattenInformationalCards", () => {
  // Shaped like ChatGPT's estimator: one configurator panel, the rest
  // informational sections (a table, a nested breakdown).
  const components = [
    {
      id: "root",
      component: "Column",
      children: ["controls", "breakdown", "outlined", "panel"],
    },
    { id: "controls", component: "Card", children: ["c-title", "c-row"] },
    { id: "c-title", component: "Title", text: "Your project" },
    { id: "c-row", component: "Row", children: ["seats"] },
    { id: "seats", component: "Slider", value: { path: "/seats" } },
    { id: "breakdown", component: "Card", children: ["b-title", "b-table"] },
    { id: "b-title", component: "Title", text: "Breakdown" },
    {
      id: "b-table",
      component: "Table",
      columns: ["Item", "Cost"],
      rows: [["Seats", "$8"]],
    },
    { id: "outlined", component: "Card", variant: "outline", children: ["o"] },
    { id: "o", component: "Text", text: "boxed on purpose" },
    { id: "panel", component: "Card", children: ["inner", "submit"] },
    { id: "inner", component: "Card", children: ["inner-text"] },
    { id: "inner-text", component: "Text", text: "summary" },
    { id: "submit", component: "Button", label: "Go" },
  ];
  const ops = [
    { version: "v1.0", updateComponents: { surfaceId: "s", components } },
  ];
  const card = (out: A2UIMarkdownOperation[], id: string) =>
    componentsOf(out).find((c) => c.id === id)!;

  it("classifies cards with a control descendant as interactive", () => {
    expect([...classifySurfaceCards(components)].sort()).toEqual([
      "controls",
      "panel",
    ]);
  });

  it("finds controls placed in table cells and child templates", () => {
    const set = classifySurfaceCards([
      { id: "a", component: "Card", children: ["t"] },
      { id: "t", component: "Table", rows: [[{ componentId: "btn" }]] },
      { id: "btn", component: "Button" },
      {
        id: "b",
        component: "Card",
        children: { componentId: "row", path: "/x" },
      },
      { id: "row", component: "CheckBox" },
    ]);
    expect([...set].sort()).toEqual(["a", "b"]);
  });

  it("turns informational cards into sections and leaves the rest alone", () => {
    const out = flattenInformationalCards(ops);
    expect(card(out, "controls").variant).toBeUndefined();
    expect(card(out, "breakdown").variant).toBe("section");
    expect(card(out, "outlined").variant).toBe("outline");
    expect(card(out, "panel").variant).toBeUndefined();
    // A card nested inside an interactive panel is left to the renderer.
    expect(card(out, "inner").variant).toBeUndefined();
  });

  it("keeps an explicit border and passes non-component operations through", () => {
    const data = {
      version: "v1.0",
      updateDataModel: { surfaceId: "s", value: {} },
    };
    const input = [
      {
        version: "v1.0",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "k", component: "Card", border: true }],
        },
      },
      data,
    ];
    const out = flattenInformationalCards(input);
    expect(card(out, "k").variant).toBeUndefined();
    expect(out[1]).toBe(data);
  });
});

describe("segmentSurfaceProse", () => {
  type Segment = ReturnType<typeof segmentSurfaceProse>[number];
  /** A compact view: markdown text, or the component ids of a surface. */
  const shape = (segments: Segment[]) =>
    segments.map((s) =>
      s.kind === "markdown"
        ? { markdown: s.markdown }
        : { surface: s.components.map((c) => c.id) },
    );
  const surfaceRoot = (segment: Segment | undefined) => {
    if (segment?.kind !== "surface") throw new Error("not a surface segment");
    return segment.components[0];
  };
  const slider = (id: string) => ({
    id,
    component: "Slider",
    min: 0,
    max: 1,
    value: 0,
  });

  it("moves everything but the chart of a Lisbon itinerary into markdown", () => {
    const out = segmentSurfaceProse([
      {
        id: "root",
        component: "Column",
        gap: 4,
        children: [
          "title",
          "intro",
          "plan",
          "days",
          "div",
          "ct",
          "cap",
          "chart",
        ],
      },
      {
        id: "title",
        component: "Title",
        text: "5-Day Trip to Lisbon",
        size: "2xl",
      },
      { id: "intro", component: "Text", text: "A balanced plan." },
      { id: "plan", component: "Title", text: "Itinerary", size: "lg" },
      {
        id: "days",
        component: "List",
        marker: "number",
        items: ["Alfama", "Belém", "Sintra", "LX Factory", "Cascais"],
      },
      { id: "div", component: "Divider" },
      { id: "ct", component: "Title", text: "Daily budget", size: "lg" },
      { id: "cap", component: "Caption", text: "Estimates in EUR" },
      { id: "chart", component: "Chart", data: [] },
    ]);
    expect(shape(out)).toEqual([
      {
        markdown:
          "## 5-Day Trip to Lisbon\n\nA balanced plan.\n\n### Itinerary\n\n" +
          "1. Alfama\n2. Belém\n3. Sintra\n4. LX Factory\n5. Cascais\n\n---\n\n" +
          "### Daily budget\n\nEstimates in EUR",
      },
      { surface: ["root", "chart"] },
    ]);
    expect(surfaceRoot(out[1])).toEqual({
      id: "root",
      component: "Column",
      gap: 4,
      children: ["chart"],
    });
  });

  it("splits interior prose into its own markdown segment between two surfaces", () => {
    const out = segmentSurfaceProse([
      { id: "root", component: "Column", children: ["panel", "t", "tbl"] },
      { id: "panel", component: "Card", children: ["pt", "sl"] },
      { id: "pt", component: "Title", text: "Your team" },
      slider("sl"),
      { id: "t", component: "Title", text: "Plan comparison", size: "lg" },
      { id: "tbl", component: "Table", columns: ["A"], rows: [["1"]] },
    ]);
    expect(shape(out)).toEqual([
      { surface: ["root", "panel", "pt", "sl"] },
      { markdown: "### Plan comparison" },
      { surface: ["root", "tbl"] },
    ]);
    expect(surfaceRoot(out[0])).toMatchObject({ children: ["panel"] });
    expect(surfaceRoot(out[2])).toMatchObject({ children: ["tbl"] });
  });

  it("handles prose on both sides of two UI runs", () => {
    const out = segmentSurfaceProse([
      {
        id: "root",
        component: "Column",
        children: ["t", "a", "mid", "b", "note"],
      },
      { id: "t", component: "Title", text: "Plan", size: "sm" },
      slider("a"),
      { id: "mid", component: "Text", text: "Then pick a tier." },
      slider("b"),
      { id: "note", component: "Text", text: "Prices vary.", strong: true },
    ]);
    expect(shape(out)).toEqual([
      { markdown: "#### Plan" },
      { surface: ["root", "a"] },
      { markdown: "Then pick a tier." },
      { surface: ["root", "b"] },
      { markdown: "**Prices vary.**" },
    ]);
  });

  it("keeps a divider only between two prose blocks", () => {
    const out = segmentSurfaceProse([
      {
        id: "root",
        component: "Column",
        children: ["s", "d1", "note", "d", "c"],
      },
      slider("s"),
      { id: "d1", component: "Divider" },
      { id: "note", component: "Text", text: "Prices vary." },
      { id: "d", component: "Divider" },
      { id: "c", component: "Caption", text: "Updated today" },
    ]);
    expect(shape(out)).toEqual([
      { surface: ["root", "s"] },
      { markdown: "Prices vary.\n\n---\n\nUpdated today" },
    ]);
  });

  it("keeps separators with no text beside them in the surface", () => {
    const out = segmentSurfaceProse([
      {
        id: "root",
        component: "Column",
        children: ["d0", "a", "d", "b", "t", "later", "sp"],
      },
      { id: "d0", component: "Divider" },
      slider("a"),
      { id: "d", component: "Divider" },
      slider("b"),
      { id: "t", component: "Title", text: "Trip", size: "xl" },
      { id: "sp", component: "Spacer" },
    ]);
    // "later" has not streamed yet, so it is not prose.
    expect(shape(out)).toEqual([
      { surface: ["root", "d0", "a", "d", "b"] },
      { markdown: "## Trip" },
      { surface: ["root", "sp"] },
    ]);
    expect(surfaceRoot(out[0])).toMatchObject({
      children: ["d0", "a", "d", "b"],
    });
    expect(surfaceRoot(out[2])).toMatchObject({ children: ["later", "sp"] });
  });

  it("descends through single-child containers to the stack", () => {
    const out = segmentSurfaceProse([
      { id: "root", component: "Column", children: ["sec"] },
      { id: "sec", component: "Card", variant: "section", child: "col" },
      { id: "col", component: "Column", padding: 2, children: ["t", "tbl"] },
      { id: "t", component: "Title", text: "Costs", size: "lg" },
      { id: "tbl", component: "Table", columns: ["A"], rows: [["1"]] },
    ]);
    expect(shape(out)).toEqual([
      { markdown: "### Costs" },
      { surface: ["root", "tbl"] },
    ]);
    expect(surfaceRoot(out[1])).toEqual({
      id: "root",
      component: "Column",
      padding: 2,
      children: ["tbl"],
    });
  });

  it("drops the stack's lone child when it becomes the root", () => {
    const out = segmentSurfaceProse([
      { id: "root", component: "Column", children: ["sec"] },
      { id: "sec", component: "Card", variant: "section", child: "t" },
      { id: "t", component: "Title", text: "Only words" },
    ]);
    expect(shape(out)).toEqual([{ markdown: "### Only words" }]);
  });

  it("returns only markdown for a surface that is all prose", () => {
    const out = segmentSurfaceProse([
      { id: "root", component: "Column", children: ["t", "m"] },
      { id: "t", component: "Title", text: "Summary" },
      { id: "m", component: "Markdown", text: "Just **words**." },
    ]);
    expect(out).toEqual([
      { kind: "markdown", markdown: "### Summary\n\nJust **words**." },
    ]);
  });

  it("treats a prose root as the whole surface", () => {
    expect(
      segmentSurfaceProse([{ id: "root", component: "Text", text: "Hello" }]),
    ).toEqual([{ kind: "markdown", markdown: "Hello" }]);
  });

  it("returns the input unchanged when nothing is prose", () => {
    const bound = [
      { id: "root", component: "Column", children: ["t", "s"] },
      { id: "t", component: "Title", text: { path: "/title" } },
      slider("s"),
    ];
    const [whole] = segmentSurfaceProse(bound);
    expect(whole?.kind === "surface" && whole.components).toBe(bound);
    const inline = [
      { id: "root", component: "Column", children: ["t", "s"] },
      { id: "t", component: "Text", text: "Seats", children: ["badge"] },
      { id: "badge", component: "Badge", text: "new" },
      slider("s"),
    ];
    expect(shape(segmentSurfaceProse(inline))).toEqual([
      { surface: ["root", "t", "badge", "s"] },
    ]);
    const noRoot = [{ id: "t", component: "Title", text: "Trip" }];
    expect(segmentSurfaceProse(noRoot)).toEqual([
      { kind: "surface", components: noRoot },
    ]);
  });

  it("never enters an interactive Card", () => {
    const components = [
      { id: "root", component: "Column", children: ["panel"] },
      { id: "panel", component: "Card", children: ["t", "s"] },
      { id: "t", component: "Title", text: "Your project" },
      slider("s"),
    ];
    const [only, ...rest] = segmentSurfaceProse(components);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ kind: "surface" });
    expect(only?.kind === "surface" && only.components).toBe(components);
  });

  it("keeps template children in the surface", () => {
    const template = [
      {
        id: "root",
        component: "Column",
        children: { componentId: "row", path: "/items" },
      },
      { id: "row", component: "Text", text: "Item" },
    ];
    expect(shape(segmentSurfaceProse(template))).toEqual([
      { surface: ["root", "row"] },
    ]);
    const mixed = segmentSurfaceProse([
      {
        id: "root",
        component: "Column",
        children: [{ componentId: "row", path: "/items" }, "t"],
      },
      { id: "row", component: "Text", text: "Item" },
      { id: "t", component: "Text", text: "Done" },
    ]);
    expect(shape(mixed)).toEqual([
      { surface: ["root", "row"] },
      { markdown: "Done" },
    ]);
  });

  it("keeps a prose component that UI in the surface still references", () => {
    const out = segmentSurfaceProse([
      { id: "root", component: "Column", children: ["t", "row"] },
      { id: "t", component: "Text", text: "Shared" },
      { id: "row", component: "Row", children: ["t", "b"] },
      { id: "b", component: "Button", child: "t" },
    ]);
    expect(shape(out)).toEqual([
      { markdown: "Shared" },
      { surface: ["root", "t", "row", "b"] },
    ]);
  });

  describe("List", () => {
    const list = (props: Record<string, unknown>) =>
      segmentSurfaceProse([
        { id: "root", component: "Column", children: ["l", "s"] },
        { id: "l", component: "List", ...props },
        slider("s"),
      ])[0];

    it("turns string items into a bullet list", () => {
      expect(list({ items: ["Sun", " Sea "] })).toEqual({
        kind: "markdown",
        markdown: "- Sun\n- Sea",
      });
      expect(list({ items: ["Sun"], marker: "none" })).toEqual({
        kind: "markdown",
        markdown: "- Sun",
      });
    });

    it("turns label/description items into bold labels with an em dash", () => {
      expect(
        list({
          items: [
            { label: "Day 1", description: "Alfama" },
            { label: "Day 2" },
          ],
        }),
      ).toEqual({
        kind: "markdown",
        markdown: "- **Day 1** — Alfama\n- Day 2",
      });
    });

    it("numbers a number-marker list from start", () => {
      expect(list({ items: ["a", "b"], marker: "number" })).toEqual({
        kind: "markdown",
        markdown: "1. a\n2. b",
      });
      expect(list({ items: ["a", "b"], marker: "number", start: 3 })).toEqual({
        kind: "markdown",
        markdown: "3. a\n4. b",
      });
    });

    it("keeps bound items, children, icons, actions and odd items in the surface", () => {
      const rejected = [
        { items: { path: "/days" } },
        { items: [] },
        { children: ["li"] },
        { items: ["a"], children: ["li"] },
        { items: [{ label: "a", icon: "sun" }] },
        { items: [{ label: "a", action: { event: { name: "x" } } }] },
        { items: [{ label: "a", extra: 1 }] },
        { items: [{ label: { path: "/a" } }] },
        { items: [{ label: "a", description: { path: "/d" } }] },
        { items: ["a", ""] },
        { items: [{ label: " " }] },
      ];
      for (const props of rejected) {
        expect(list(props)).toMatchObject({ kind: "surface" });
      }
    });
  });
});
