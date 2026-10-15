import { describe, expect, it } from "vitest";
import {
  extractCompleteArrayItems,
  extractFenceOperations,
  extractStringField,
  getOperationSurfaceId,
  prepareSurfaceOperations,
  classifySurfaceCards,
  flattenInformationalCards,
  hoistSurfaceProse,
} from "../a2ui-markdown";

const CREATE =
  '{"version":"v0.9","createSurface":{"surfaceId":"plan","catalogId":"cat"}}';
const UPDATE =
  '{"version":"v0.9","updateComponents":{"surfaceId":"plan","components":[{"id":"root","component":"Column","children":["t"]},{"id":"t","component":"Text","text":"hi"}]}}';
const DATA =
  '{"version":"v0.9","updateDataModel":{"surfaceId":"plan","path":"/","value":{"seats":8}}}';

describe("extractStringField", () => {
  it("reads a string field from partial JSON", () => {
    expect(
      extractStringField(
        '{"version":"v0.9","createSurface":{"surfaceId":"plan","cat',
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
      version: "v0.9",
      updateComponents: {
        surfaceId: "plan",
        components: [{ id: "root", component: "Column", children: ["t"] }],
      },
    });
    expect(res.partialLine).toBe(partial);
  });
  it("emits nothing for a partial line without complete components", () => {
    const res = extractFenceOperations(
      `${CREATE}\n{"version":"v0.9","updateComponents":{"surfaceId":"plan","components":[{"id":"ro`,
    );
    expect(res.operations).toHaveLength(1);
  });
  it("emits a partial createSurface once the surfaceId string is complete", () => {
    const res = extractFenceOperations(
      '{"version":"v0.9","createSurface":{"surfaceId":"plan","catalogI',
    );
    expect(res.operations).toEqual([
      { version: "v0.9", createSurface: { surfaceId: "plan" } },
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
    const res = prepareSurfaceOperations({
      operations: [JSON.parse(CREATE), JSON.parse(UPDATE)],
      fallbackSurfaceId: "m1-0",
      catalogId: "cat",
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
    const res = prepareSurfaceOperations({
      operations: [op],
      fallbackSurfaceId: "m1-0",
      catalogId: "cat",
    });
    expect(res.surfaceId).toBe("m1-0");
    expect(res.operations[0]).toEqual({
      version: "v0.9",
      createSurface: { surfaceId: "m1-0", catalogId: "cat" },
    });
    expect(res.operations[1]).toEqual({
      version: "v0.9",
      updateComponents: {
        surfaceId: "m1-0",
        components: op.updateComponents.components,
      },
    });
  });
  it("adds version v0.9 when missing", () => {
    const res = prepareSurfaceOperations({
      operations: [{ createSurface: { surfaceId: "a" } }],
      fallbackSurfaceId: "f",
      catalogId: "cat",
    });
    expect(res.operations[0]).toEqual({
      version: "v0.9",
      createSurface: { surfaceId: "a", catalogId: "cat" },
    });
  });
});

describe("getOperationSurfaceId", () => {
  it("reads nested and top-level surfaceIds", () => {
    expect(getOperationSurfaceId({ updateDataModel: { surfaceId: "x" } })).toBe(
      "x",
    );
    expect(getOperationSurfaceId({ surfaceId: "y" })).toBe("y");
    expect(getOperationSurfaceId({ foo: 1 })).toBeUndefined();
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
    const res = prepareSurfaceOperations({
      operations: [
        JSON.parse(CREATE),
        JSON.parse(UPDATE),
        JSON.parse(CREATE),
        JSON.parse(DATA),
      ],
      fallbackSurfaceId: "f",
      catalogId: "cat",
    });
    expect(res.operations.filter((op) => "createSurface" in op)).toHaveLength(
      1,
    );
    expect(res.operations[0]).toHaveProperty("createSurface");
    expect(res.operations).toHaveLength(3);
  });
  it("always uses the client-provided catalogId", () => {
    const res = prepareSurfaceOperations({
      operations: [
        { createSurface: { surfaceId: "a", catalogId: "model-made-this-up" } },
      ],
      fallbackSurfaceId: "f",
      catalogId: "client-cat",
    });
    expect(res.operations[0]).toEqual({
      version: "v0.9",
      createSurface: { surfaceId: "a", catalogId: "client-cat" },
    });
  });
});

describe("extractFenceOperations partial updateDataModel", () => {
  it("emits the complete array items of a streaming value", () => {
    const res = extractFenceOperations(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/","value":{"rows":[{"a":1},{"a":2}',
    );
    expect(res.operations).toEqual([
      {
        version: "v0.9",
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
      '{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/","value":{"seats":8}',
    );
    expect(res.operations).toEqual([
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "s", path: "/", value: { seats: 8 } },
      },
    ]);
  });
  it("keeps complete scalars next to a streaming array", () => {
    const res = extractFenceOperations(
      '{"updateDataModel":{"surfaceId":"s","value":{"title":"T","rows":[{"a":1},{"a"',
    );
    expect(res.operations[0]).toEqual({
      version: "v0.9",
      updateDataModel: {
        surfaceId: "s",
        value: { title: "T", rows: [{ a: 1 }] },
      },
    });
  });
  it("emits nothing until some value content is complete", () => {
    expect(
      extractFenceOperations(
        '{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/","value":{"rows":[{"a":1',
      ).operations,
    ).toEqual([]);
    expect(
      extractFenceOperations(
        '{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/"',
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
        version: "v0.9",
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
      version: "v0.9",
      updateDataModel: { value: { surfaceId: "inner", rows: [1, 2] } },
    });
  });
  it("finds a surfaceId written after components once its string closes", () => {
    const head =
      '{"version":"v0.9","updateComponents":{"components":[{"id":"root","component":"Text","text":"x"}],"surfaceId":"pl';
    expect(
      (extractFenceOperations(head).operations[0] as any).updateComponents,
    ).not.toHaveProperty("surfaceId");
    expect(
      (extractFenceOperations(head + 'an"').operations[0] as any)
        .updateComponents.surfaceId,
    ).toBe("plan");
  });
});

describe("extractFenceOperations object stream", () => {
  const COMPONENTS = [
    { id: "root", component: "Column", children: ["t"] },
    { id: "t", component: "Text", text: "hi" },
  ];
  const PRETTY = [
    '{"version":"v0.9","updateComponents":{"surfaceId":"plan","components":[',
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
      version: "v0.9",
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
        version: "v0.9",
        updateComponents: { surfaceId: "plan", components: COMPONENTS },
      },
      JSON.parse(DATA),
    ]);
    expect(res.invalidLines).toEqual([broken]);
  });

  it("salvages a balanced object that does not parse", () => {
    const broken =
      '{"version":"v0.9","updateComponents":{"surfaceId":"plan","components":[{"id":"root","component":"Text","text":"x"},{"id":"y" "bad"}]}}';
    const res = extractFenceOperations(`${broken}\n`);
    expect(res.operations).toEqual([
      {
        version: "v0.9",
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
        version: "v0.9",
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
      version: "v0.9",
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
    const fence = `{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Column","children":["form"]},{"id":"form","component":"Form","action":{"event":{"name":"submit","context":{"message":"x"}},"children":["a"]},{"id":"a","component":"Text","text":"A"}]}}`;
    const { operations } = extractFenceOperations(fence);
    const components = (
      operations[0]?.updateComponents as { components: { id: string }[] }
    ).components;
    expect(components.map((c) => c.id)).toEqual(["root", "form", "a"]);
    expect(components[1]).toHaveProperty("children", ["a"]);
  });
});

describe("classifySurfaceCards / flattenInformationalCards", () => {
  // Shaped like a price estimator: one configurator panel, the rest
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
    { version: "v0.9", updateComponents: { surfaceId: "s", components } },
  ];
  const card = (out: Record<string, unknown>[], id: string) =>
    (
      out[0]!.updateComponents as { components: Record<string, unknown>[] }
    ).components.find((c) => c.id === id)!;

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
      version: "v0.9",
      updateDataModel: { surfaceId: "s", value: {} },
    };
    const input = [
      {
        version: "v0.9",
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

describe("hoistSurfaceProse", () => {
  const lisbon = [
    {
      id: "root",
      component: "Column",
      children: ["title", "intro", "div", "days", "chart"],
    },
    {
      id: "title",
      component: "Title",
      text: "5-Day Trip to Lisbon",
      size: "2xl",
    },
    {
      id: "intro",
      component: "Text",
      text: "A balanced plan with **food** and views.",
    },
    { id: "div", component: "Divider" },
    { id: "days", component: "List", children: ["d1"] },
    { id: "d1", component: "Text", text: "Day 1" },
    { id: "chart", component: "Chart", data: [] },
  ];

  it("hoists a leading title and intro and starts the surface at the List", () => {
    const out = hoistSurfaceProse(lisbon);
    expect(out.leading).toBe(
      "## 5-Day Trip to Lisbon\n\nA balanced plan with **food** and views.",
    );
    expect(out.trailing).toBe("");
    expect(out.components.map((c) => c.id)).toEqual([
      "root",
      "days",
      "d1",
      "chart",
    ]);
    expect(out.components[0]).toMatchObject({ children: ["days", "chart"] });
  });

  it("hoists trailing prose and keeps a divider only between peeled blocks", () => {
    const out = hoistSurfaceProse([
      {
        id: "root",
        component: "Column",
        children: ["t", "s", "note", "d", "c"],
      },
      { id: "t", component: "Title", text: "Plan", size: "sm" },
      { id: "s", component: "Slider", min: 0, max: 1, value: 0 },
      { id: "note", component: "Text", text: "Prices vary.", strong: true },
      { id: "d", component: "Divider" },
      { id: "c", component: "Caption", text: "Updated today" },
    ]);
    expect(out.leading).toBe("#### Plan");
    expect(out.trailing).toBe("**Prices vary.**\n\n---\n\nUpdated today");
    expect(out.components.map((c) => c.id)).toEqual(["root", "s"]);
  });

  it("descends through single-child containers to the stack", () => {
    const out = hoistSurfaceProse([
      { id: "root", component: "Column", children: ["sec"] },
      { id: "sec", component: "Card", variant: "section", child: "col" },
      { id: "col", component: "Column", children: ["t", "tbl"] },
      { id: "t", component: "Title", text: "Costs", size: "lg" },
      { id: "tbl", component: "Table", columns: ["A"], rows: [["1"]] },
    ]);
    expect(out.leading).toBe("### Costs");
    expect(out.components.find((c) => c.id === "col")).toMatchObject({
      children: ["tbl"],
    });
    expect(out.components.find((c) => c.id === "root")).toBeDefined();
  });

  it("returns no components for a surface that is all prose", () => {
    const out = hoistSurfaceProse([
      { id: "root", component: "Column", children: ["t", "m"] },
      { id: "t", component: "Title", text: "Summary" },
      { id: "m", component: "Markdown", text: "Just **words**." },
    ]);
    expect(out.components).toEqual([]);
    expect(out.leading).toBe("### Summary\n\nJust **words**.");
  });

  it("treats a prose root as the whole surface", () => {
    const out = hoistSurfaceProse([
      { id: "root", component: "Text", text: "Hello" },
    ]);
    expect(out).toEqual({ components: [], leading: "Hello", trailing: "" });
  });

  it("does not hoist a path-bound Title", () => {
    const components = [
      { id: "root", component: "Column", children: ["t", "s"] },
      { id: "t", component: "Title", text: { path: "/title" } },
      { id: "s", component: "Slider", min: 0, max: 1, value: 0 },
    ];
    expect(hoistSurfaceProse(components)).toEqual({
      components,
      leading: "",
      trailing: "",
    });
  });

  it("leaves an interactive Card-wrapped stack untouched", () => {
    const components = [
      { id: "root", component: "Column", children: ["panel"] },
      { id: "panel", component: "Card", children: ["t", "s"] },
      { id: "t", component: "Title", text: "Your project" },
      { id: "s", component: "Slider", min: 0, max: 1, value: 0 },
    ];
    expect(hoistSurfaceProse(components).components).toBe(components);
  });

  it("leaves template children alone", () => {
    const components = [
      {
        id: "root",
        component: "Column",
        children: { componentId: "row", path: "/items" },
      },
      { id: "row", component: "Text", text: "Item" },
    ];
    expect(hoistSurfaceProse(components).components).toBe(components);
    const mixed = hoistSurfaceProse([
      {
        id: "root",
        component: "Column",
        children: [{ componentId: "row", path: "/items" }, "t"],
      },
      { id: "row", component: "Text", text: "Item" },
      { id: "t", component: "Text", text: "Done" },
    ]);
    expect(mixed.leading).toBe("");
    expect(mixed.trailing).toBe("Done");
  });

  it("stops at a child that has not streamed yet and never peels a lone divider", () => {
    const out = hoistSurfaceProse([
      { id: "root", component: "Column", children: ["t", "later", "d"] },
      { id: "t", component: "Title", text: "Trip", size: "xl" },
      { id: "d", component: "Divider" },
    ]);
    expect(out.leading).toBe("## Trip");
    expect(out.trailing).toBe("");
    expect(out.components.find((c) => c.id === "root")).toMatchObject({
      children: ["later", "d"],
    });
  });

  it("keeps a peeled component that something else still references", () => {
    const out = hoistSurfaceProse([
      { id: "root", component: "Column", children: ["t", "row"] },
      { id: "t", component: "Text", text: "Shared" },
      { id: "row", component: "Row", children: ["t", "b"] },
      { id: "b", component: "Button", child: "t" },
    ]);
    expect(out.leading).toBe("Shared");
    expect(out.components.map((c) => c.id)).toContain("t");
  });
});
