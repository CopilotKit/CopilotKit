import { describe, it, expect } from "vitest";
import { jsonSchemaToFormSchema } from "../json-schema";

describe("jsonSchemaToFormSchema", () => {
  it("maps primitive properties", () => {
    const out = jsonSchemaToFormSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        active: { type: "boolean" },
      },
      required: ["name"],
    });
    expect(out.fields).toHaveLength(3);
    expect(out.fields.find((f) => f.name === "name")!.required).toBe(true);
    expect(out.fields.find((f) => f.name === "age")!.required).toBe(false);
  });

  it("treats integer as number", () => {
    const out = jsonSchemaToFormSchema({
      type: "object",
      properties: { count: { type: "integer" } },
    });
    expect(out.fields[0].kind).toBe("number");
  });

  it("falls back to raw-json when array is missing items", () => {
    const out = jsonSchemaToFormSchema({
      type: "object",
      properties: { xs: { type: "array" } },
    });
    expect(out.fields[0].kind).toBe("raw-json");
  });

  it("maps string enum", () => {
    const out = jsonSchemaToFormSchema({
      type: "object",
      properties: { color: { type: "string", enum: ["red", "blue"] } },
    });
    expect(out.fields[0]).toMatchObject({
      kind: "string",
      enum: ["red", "blue"],
    });
  });

  it("maps array of primitives", () => {
    const out = jsonSchemaToFormSchema({
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
    });
    expect(out.fields[0]).toMatchObject({
      kind: "array",
      items: { kind: "string" },
    });
  });

  it("maps nested objects", () => {
    const out = jsonSchemaToFormSchema({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    });
    expect(out.fields[0]).toMatchObject({
      kind: "object",
      fields: [{ kind: "string", name: "id", required: true }],
    });
  });

  it("falls back to raw-json on unknown shapes", () => {
    const out = jsonSchemaToFormSchema({
      type: "object",
      properties: { weird: { type: "null" } },
    });
    expect(out.fields[0].kind).toBe("raw-json");
  });

  it("returns empty fields for a non-object root", () => {
    expect(jsonSchemaToFormSchema({ type: "string" }).fields).toEqual([]);
  });
});
