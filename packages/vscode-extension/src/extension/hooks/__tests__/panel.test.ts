import { describe, it, expect } from "vitest";
import { extractSchemaHint } from "../schema-extraction";

describe("extractSchemaHint", () => {
  it("returns v1-params when config has a parameters array", () => {
    const hint = extractSchemaHint({
      parameters: [{ name: "a", type: "string" }],
    });
    expect(hint).toEqual({
      kind: "v1-params",
      payload: [{ name: "a", type: "string" }],
    });
  });

  it("returns standard-schema when config.parameters is a Standard Schema", () => {
    const schema = { "~standard": { vendor: "zod", version: 1 } };
    const hint = extractSchemaHint({ parameters: schema });
    expect(hint.kind).toBe("standard-schema");
    expect(hint.payload).toBe(schema);
  });

  it("returns none for no schema", () => {
    expect(extractSchemaHint({})).toEqual({ kind: "none", payload: null });
  });
});
