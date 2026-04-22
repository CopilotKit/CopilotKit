import { describe, it, expect } from "vitest";
import { z } from "zod";
import { inferFormSchemaFromConfig } from "../infer-from-config";

describe("inferFormSchemaFromConfig", () => {
  it("infers a v1-parameters form from an array parameters", () => {
    const schema = inferFormSchemaFromConfig({
      parameters: [
        { name: "text", type: "string", required: true },
        { name: "count", type: "number", required: false },
      ],
    });
    expect(schema.fields).toHaveLength(2);
    expect(schema.fields[0]).toMatchObject({ kind: "string", name: "text" });
    expect(schema.fields[1]).toMatchObject({ kind: "number", name: "count" });
  });

  it("infers a standard-schema form from a Zod object", () => {
    const schema = inferFormSchemaFromConfig({
      parameters: z.object({
        who: z.string(),
        times: z.number(),
      }),
    });
    expect(schema.fields.map((f) => f.name).sort()).toEqual(["times", "who"]);
  });

  it("returns empty fields for a config without parameters", () => {
    expect(inferFormSchemaFromConfig({}).fields).toEqual([]);
    expect(inferFormSchemaFromConfig(undefined).fields).toEqual([]);
    expect(inferFormSchemaFromConfig(null).fields).toEqual([]);
  });

  it("returns empty fields for non-array, non-standard-schema parameters", () => {
    expect(
      inferFormSchemaFromConfig({ parameters: "not-a-schema" }).fields,
    ).toEqual([]);
    expect(inferFormSchemaFromConfig({ parameters: 42 }).fields).toEqual([]);
  });
});
