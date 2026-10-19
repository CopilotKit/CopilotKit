import { describe, expect, it } from "vitest";
import { RenderUIArgsStream, extractRenderUIArgs } from "../render-ui-args";

const opA = {
  version: "v1.0",
  createSurface: { surfaceId: "s" },
};
const opB = {
  version: "v1.0",
  updateComponents: {
    surfaceId: "s",
    components: [
      {
        id: "root",
        component: "Grid",
        children: ["c1"],
        title: 'He said "}{" ok',
      },
    ],
  },
};
const opC = {
  version: "v1.0",
  updateDataModel: { surfaceId: "s", path: "/a", value: [1, { b: "]" }] },
};
/** One createSurface with the data model and the root inline. */
const inlineCreate = {
  version: "v1.0",
  createSurface: {
    surfaceId: "plan",
    dataModel: { seats: 10, plans: [{ name: "Team" }] },
    components: [
      {
        id: "root",
        component: "Column",
        children: { componentId: "row", path: "/plans" },
      },
      { id: "row", component: "Text", text: { "@call": "@index" } },
    ],
  },
};
const functionCall = {
  version: "v1.0",
  callRendererFunction: {
    functionCallId: "f1",
    callFunction: { "@call": "addToCart", args: { productId: "p{1}" } },
  },
};

describe("extractRenderUIArgs", () => {
  it("extracts target and every complete operation from a full payload", () => {
    const text = JSON.stringify({
      target: "recommendations",
      operations: [opA, opB, opC],
    });
    expect(extractRenderUIArgs(text)).toEqual({
      target: "recommendations",
      operations: [opA, opB, opC],
    });
  });

  it("does not return an operation until its closing brace has arrived", () => {
    const text = JSON.stringify({ target: "chat", operations: [opA, opB] });
    const cut = text.indexOf("updateComponents") + 5;
    expect(extractRenderUIArgs(text.slice(0, cut)).operations).toEqual([opA]);
  });

  it("finds operations that precede the target key", () => {
    const text = JSON.stringify({ operations: [opA], target: "chat" });
    expect(extractRenderUIArgs(text)).toEqual({
      target: "chat",
      operations: [opA],
    });
  });

  it("returns null for a balanced element that is not valid JSON", () => {
    const text =
      '{"target":"chat","operations":[{"version":"v1.0", bad},' +
      JSON.stringify(opA) +
      "]}";
    expect(extractRenderUIArgs(text).operations).toEqual([null, opA]);
  });

  it("flags an operation that was opened but never closed", () => {
    const text = JSON.stringify({ target: "chat", operations: [opA, opB] });
    const cut = text.indexOf("updateComponents") + 5;
    expect(extractRenderUIArgs(text.slice(0, cut)).incompleteOperation).toBe(
      true,
    );
    expect(extractRenderUIArgs(text).incompleteOperation).toBeUndefined();
  });

  it("ignores string values that look like keys", () => {
    const text = JSON.stringify({
      note: "target",
      target: "chat",
      operations: [],
    });
    expect(extractRenderUIArgs(text).target).toBe("chat");
  });
});

describe("RenderUIArgsStream", () => {
  it("emits each operation exactly once when streamed one character at a time", () => {
    const text = JSON.stringify({
      target: "recommendations",
      operations: [opA, opB, opC],
    });
    const stream = new RenderUIArgsStream();
    const emitted: unknown[] = [];
    let target: string | undefined;
    for (const ch of text) {
      const update = stream.push(ch);
      target = update.target ?? target;
      emitted.push(...update.newOperations);
    }
    expect(target).toBe("recommendations");
    expect(emitted).toEqual([opA, opB, opC]);
  });

  it("emits an inline createSurface and a callRendererFunction once each", () => {
    const text = JSON.stringify({
      target: "chat",
      operations: [inlineCreate, functionCall],
    });
    const stream = new RenderUIArgsStream();
    const emitted: unknown[] = [];
    for (const ch of text) emitted.push(...stream.push(ch).newOperations);
    expect(emitted).toEqual([inlineCreate, functionCall]);
  });

  it("holds back an inline createSurface until its components array closes", () => {
    const text = JSON.stringify({ target: "chat", operations: [inlineCreate] });
    const cut = text.indexOf('"row","component"');
    const stream = new RenderUIArgsStream();
    expect(stream.push(text.slice(0, cut)).newOperations).toEqual([]);
    expect(stream.hasIncompleteOperation).toBe(true);
    expect(stream.push(text.slice(cut)).newOperations).toEqual([inlineCreate]);
  });

  it("exposes the accumulated text and whether it ends mid-operation", () => {
    const text = JSON.stringify({ target: "chat", operations: [opA, opB] });
    const cut = text.indexOf("updateComponents");
    const stream = new RenderUIArgsStream();
    stream.push(text.slice(0, cut));
    expect(stream.text).toBe(text.slice(0, cut));
    expect(stream.hasIncompleteOperation).toBe(true);
    stream.push(text.slice(cut));
    expect(stream.hasIncompleteOperation).toBe(false);
  });
});
