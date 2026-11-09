import { describe, expect, it } from "vitest";
import { parseGenerativeUISurfaceContent } from "../activity";
import * as native from "../native";

const good = {
  surfaceId: "s1",
  target: "chat",
  catalogId: "shop",
  operations: [],
  status: "ready",
  rejected: [{ index: 0, reason: "bad" }],
};

describe("parseGenerativeUISurfaceContent", () => {
  it("reads valid content, keeps its extra keys, and reads a missing rejected as []", () => {
    expect(parseGenerativeUISurfaceContent({ ...good, extra: 1 })).toEqual({
      content: { ...good, extra: 1 },
    });
    const { rejected: _drop, ...noRejected } = good;
    expect(
      parseGenerativeUISurfaceContent(noRejected).content?.rejected,
    ).toEqual([]);
  });

  it.each([
    ["null", null, ["content"]],
    ["an array", [], ["content"]],
    ["no target", { ...good, target: undefined }, ["target"]],
    ["an unknown status", { ...good, status: "done" }, ["status"]],
    [
      "operations that are not a list",
      { ...good, operations: {} },
      ["operations"],
    ],
    [
      "a rejected entry with a NaN index",
      { ...good, rejected: [{ index: Number.NaN, reason: "x" }] },
      ["rejected[0].index"],
    ],
    [
      "a rejected entry that is not an object",
      { ...good, rejected: [{ index: 0, reason: "x" }, "bad"] },
      ["rejected[1]"],
    ],
  ])("names the path of each issue, for %s", (_label, content, paths) => {
    const parsed = parseGenerativeUISurfaceContent(content);
    expect(parsed.content).toBeUndefined();
    expect(parsed.issues?.map((issue) => issue.split(":")[0])).toEqual(paths);
  });

  it("never throws, even for content whose getter throws", () => {
    const content = {
      ...good,
      get surfaceId(): string {
        throw new Error("getter");
      },
    };
    expect(() => parseGenerativeUISurfaceContent(content)).not.toThrow();
  });
});

describe("the native entry", () => {
  it("exports the content schema and the activity logic for other platforms", () => {
    expect(
      native.GenerativeUISurfaceContentSchema.safeParse(good).success,
    ).toBe(true);
    expect(native.parseGenerativeUISurfaceContent).toBe(
      parseGenerativeUISurfaceContent,
    );
    expect(typeof native.useGenerativeUIActivitySurface).toBe("function");
    expect(typeof native.useGenerativeUIRejected).toBe("function");
  });
});
