import { describe, it, expect } from "vitest";
import { v1ParametersToFormSchema } from "../v1-params";

describe("v1ParametersToFormSchema", () => {
  it("maps primitives", () => {
    const out = v1ParametersToFormSchema([
      { name: "a", type: "string", required: true },
      { name: "b", type: "number", required: false },
      { name: "c", type: "boolean", required: true, description: "flag" },
    ]);
    expect(out.fields).toEqual([
      { kind: "string", name: "a", label: "a", required: true },
      { kind: "number", name: "b", label: "b", required: false },
      {
        kind: "boolean",
        name: "c",
        label: "c",
        required: true,
        description: "flag",
      },
    ]);
  });

  it("maps enum on strings", () => {
    const out = v1ParametersToFormSchema([
      { name: "color", type: "string", enum: ["red", "blue"], required: true },
    ]);
    expect(out.fields[0]).toEqual({
      kind: "string",
      name: "color",
      label: "color",
      enum: ["red", "blue"],
      required: true,
    });
  });

  it("maps primitive array types", () => {
    const out = v1ParametersToFormSchema([
      { name: "tags", type: "string[]", required: true },
      { name: "scores", type: "number[]", required: false },
    ]);
    expect(out.fields[0]).toMatchObject({
      kind: "array",
      name: "tags",
      items: { kind: "string" },
    });
    expect(out.fields[1]).toMatchObject({
      kind: "array",
      name: "scores",
      items: { kind: "number" },
    });
  });

  it("recurses on nested array types like string[][]", () => {
    const out = v1ParametersToFormSchema([
      { name: "matrix", type: "string[][]", required: true },
    ]);
    expect(out.fields[0]).toMatchObject({
      kind: "array",
      name: "matrix",
      items: {
        kind: "array",
        items: { kind: "string" },
      },
    });
  });

  it("omits description from the output when not provided", () => {
    const out = v1ParametersToFormSchema([{ name: "x", type: "string" }]);
    expect(out.fields[0]).not.toHaveProperty("description");
  });

  it("maps nested object via attributes", () => {
    const out = v1ParametersToFormSchema([
      {
        name: "user",
        type: "object",
        required: true,
        attributes: [
          { name: "id", type: "string", required: true },
          { name: "active", type: "boolean", required: false },
        ],
      },
    ]);
    expect(out.fields[0]).toMatchObject({
      kind: "object",
      name: "user",
      fields: [
        { kind: "string", name: "id", required: true },
        { kind: "boolean", name: "active", required: false },
      ],
    });
  });

  it("defaults required to true when not specified", () => {
    const out = v1ParametersToFormSchema([{ name: "x", type: "string" }]);
    expect(out.fields[0].required).toBe(true);
  });

  it("falls back to raw-json for unknown types", () => {
    const out = v1ParametersToFormSchema([
      { name: "weird", type: "something-wild", required: false } as any,
    ]);
    expect(out.fields[0].kind).toBe("raw-json");
  });
});
