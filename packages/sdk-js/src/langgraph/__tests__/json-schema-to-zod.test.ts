import { afterEach, describe, expect, it, vi } from "vitest";
import { convertJsonSchemaToZodSchema } from "../json-schema-to-zod";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("convertJsonSchemaToZodSchema", () => {
  it("converts objects with required, optional, nested, and array properties", () => {
    const schema = convertJsonSchemaToZodSchema(
      {
        type: "object",
        properties: {
          name: { type: "string", description: "User name" },
          age: { type: "integer" },
          address: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["name", "address"],
      },
      true,
    );

    expect(
      schema.safeParse({ name: "Ada", address: { city: "London" } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        name: "Ada",
        age: 36,
        address: { city: "London" },
        tags: ["a", "b"],
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ name: "Ada" }).success).toBe(false);
    expect(
      schema.safeParse({ name: "Ada", address: {}, tags: [1] }).success,
    ).toBe(false);
  });

  it("makes the schema optional when not required", () => {
    const schema = convertJsonSchemaToZodSchema({ type: "string" }, false);
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse(1).success).toBe(false);
  });

  it("keeps string enums, null unions, and anyOf unions", () => {
    const schema = convertJsonSchemaToZodSchema(
      {
        type: "object",
        properties: {
          role: { type: "string", enum: ["admin", "user"] },
          note: { type: ["string", "null"] },
          id: { anyOf: [{ type: "string" }, { type: "number" }] },
        },
        required: ["role", "note", "id"],
      },
      true,
    );

    expect(schema.safeParse({ role: "admin", note: null, id: 1 }).success).toBe(
      true,
    );
    expect(schema.safeParse({ role: "user", note: "x", id: "a" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ role: "owner", note: null, id: 1 }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ role: "user", note: null, id: true }).success,
    ).toBe(false);
  });

  it("resolves $ref definitions", () => {
    const schema = convertJsonSchemaToZodSchema(
      {
        type: "object",
        properties: { home: { $ref: "#/$defs/Address" } },
        required: ["home"],
        $defs: {
          Address: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      },
      true,
    );

    expect(schema.safeParse({ home: { city: "Paris" } }).success).toBe(true);
    expect(schema.safeParse({ home: {} }).success).toBe(false);
  });

  it("falls back to z.any() for circular $ref and unsupported types", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const circular = convertJsonSchemaToZodSchema(
      {
        type: "object",
        properties: { root: { $ref: "#/$defs/Node" } },
        required: ["root"],
        $defs: {
          Node: {
            type: "object",
            properties: { child: { $ref: "#/$defs/Node" } },
          },
        },
      },
      true,
    );
    expect(
      circular.safeParse({ root: { child: { anything: 1 } } }).success,
    ).toBe(true);

    const unsupported = convertJsonSchemaToZodSchema({ type: "tuple" }, true);
    expect(unsupported.safeParse(["x", 1]).success).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
