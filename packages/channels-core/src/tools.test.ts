import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  toAgentToolDescriptors,
  parseToolArgs,
  stringifyHandlerResult,
} from "./tools.js";

describe("tools", () => {
  const tool = {
    name: "t",
    description: "d",
    parameters: z.object({ q: z.string() }),
    handler: () => "ok",
  };
  it("emits JSON-schema descriptor", () => {
    const descriptors = toAgentToolDescriptors([tool]);
    const d = descriptors[0];
    if (!d) throw new Error("expected a descriptor");
    expect(d.name).toBe("t");
    expect((d.parameters as { type?: string }).type).toBe("object");
  });
  it("parses valid and rejects invalid args", async () => {
    expect(await parseToolArgs(tool.parameters, { q: "x" })).toEqual({
      ok: true,
      value: { q: "x" },
    });
    expect((await parseToolArgs(tool.parameters, {})).ok).toBe(false);
  });
  it("stringifies handler results", () => {
    expect(stringifyHandlerResult("s")).toBe("s");
    expect(stringifyHandlerResult({ a: 1 })).toBe('{"a":1}');
    expect(stringifyHandlerResult(undefined)).toBe("");
  });
});
