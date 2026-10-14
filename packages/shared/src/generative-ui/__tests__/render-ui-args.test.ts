import { describe, expect, it } from "vitest";
import { RenderUIArgsStream, extractRenderUIArgs } from "../render-ui-args";

const opA = {
  version: "v0.9",
  createSurface: { surfaceId: "s", catalogId: "shop" },
};
const opB = {
  version: "v0.9",
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
  version: "v0.9",
  updateDataModel: { surfaceId: "s", path: "/a", value: [1, { b: "]" }] },
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
      '{"target":"chat","operations":[{"version":"v0.9", bad},' +
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
