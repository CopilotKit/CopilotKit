import { describe, expect, it } from "vitest";
import {
  extractCompleteArrayItems,
  extractFenceOperations,
  extractStringField,
  getOperationSurfaceId,
  prepareSurfaceOperations,
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
