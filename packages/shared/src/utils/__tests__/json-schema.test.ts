import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  convertJsonSchemaToZodSchema,
  actionParametersToJsonSchema,
  jsonSchemaToActionParameters,
  JSONSchema,
} from "../json-schema";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Parameter } from "../../types";

describe("convertJsonSchemaToZodSchema", () => {
  it("should convert a simple JSON schema to a Zod schema", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    };

    const expectedSchema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const resultSchemaJson = zodToJsonSchema(result);
    const expectedSchemaJson = zodToJsonSchema(expectedSchema);

    expect(resultSchemaJson).toStrictEqual(expectedSchemaJson);
  });

  it("should convert a JSON schema with nested objects to a Zod schema", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
          required: ["street", "city"],
        },
      },
      required: ["name", "address"],
    };

    const expectedSchema = z.object({
      name: z.string(),
      address: z.object({
        street: z.string(),
        city: z.string(),
      }),
    });

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const resultSchemaJson = zodToJsonSchema(result);
    const expectedSchemaJson = zodToJsonSchema(expectedSchema);

    expect(resultSchemaJson).toStrictEqual(expectedSchemaJson);
  });

  it("should convert a JSON schema with arrays to a Zod schema", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["names"],
    };

    const expectedSchema = z.object({
      names: z.array(z.string()),
    });

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const resultSchemaJson = zodToJsonSchema(result);
    const expectedSchemaJson = zodToJsonSchema(expectedSchema);

    expect(resultSchemaJson).toStrictEqual(expectedSchemaJson);
  });

  it("should convert a JSON schema with optional properties to a Zod schema", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number", required: false },
      },
    };

    const expectedSchema = z
      .object({
        name: z.string().optional(),
        age: z.number().optional(),
      })
      .optional();

    const result = convertJsonSchemaToZodSchema(jsonSchema, false);

    console.log(convertJsonSchemaToZodSchema(jsonSchema, false));

    const resultSchemaJson = zodToJsonSchema(result);
    const expectedSchemaJson = zodToJsonSchema(expectedSchema);

    expect(resultSchemaJson).toStrictEqual(expectedSchemaJson);
  });

  it("should convert a JSON schema with different types to a Zod schema", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        isAdmin: { type: "boolean" },
      },
      required: ["name", "age", "isAdmin"],
    };

    const expectedSchema = z.object({
      name: z.string(),
      age: z.number(),
      isAdmin: z.boolean(),
    });

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const resultSchemaJson = zodToJsonSchema(result);
    const expectedSchemaJson = zodToJsonSchema(expectedSchema);

    expect(resultSchemaJson).toStrictEqual(expectedSchemaJson);
  });

  it("should handle edge case where JSON schema has no properties", () => {
    const jsonSchema = {
      type: "object",
    };

    const expectedSchema = z.object({});

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const resultSchemaJson = zodToJsonSchema(result);
    const expectedSchemaJson = zodToJsonSchema(expectedSchema);

    expect(resultSchemaJson).toStrictEqual(expectedSchemaJson);
  });

  it("should preserve string enum constraints", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "The status",
          enum: ["todo", "done"],
        },
      },
      required: ["status"],
    };
    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const statusSchema = (result as z.ZodObject<any>).shape.status;
    expect(statusSchema._def.typeName).toBe("ZodEnum");
    expect(statusSchema._def.values).toEqual(["todo", "done"]);
  });

  it("should handle null-union type ['string', 'null'] as nullable", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        nickname: {
          type: ["string", "null"],
          description: "Optional nickname",
        },
      },
      required: ["nickname"],
    };

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const shape = (result as z.ZodObject<any>).shape;

    // The nickname field should accept both string and null
    expect(shape.nickname.safeParse("hello").success).toBe(true);
    expect(shape.nickname.safeParse(null).success).toBe(true);
    expect(shape.nickname.safeParse(42).success).toBe(false);
  });

  it("should handle null-union type ['number', 'null'] as nullable number", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        score: {
          type: ["number", "null"],
        },
      },
      required: ["score"],
    };

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const shape = (result as z.ZodObject<any>).shape;

    expect(shape.score.safeParse(42).success).toBe(true);
    expect(shape.score.safeParse(null).success).toBe(true);
    expect(shape.score.safeParse("hello").success).toBe(false);
  });

  it("should handle edge case where JSON schema has no required properties", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    };

    const expectedSchema = z
      .object({
        name: z.string().optional(),
        age: z.number().optional(),
      })
      .optional();

    const result = convertJsonSchemaToZodSchema(jsonSchema, false);
    const resultSchemaJson = zodToJsonSchema(result);
    const expectedSchemaJson = zodToJsonSchema(expectedSchema);

    expect(resultSchemaJson).toStrictEqual(expectedSchemaJson);
  });

  it("should resolve non-circular $ref definitions correctly", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        address: { $ref: "#/$defs/Address" },
      },
      required: ["address"],
      $defs: {
        Address: {
          type: "object",
          properties: {
            street: { type: "string", description: "Street name" },
            city: { type: "string", description: "City name" },
          },
          required: ["street", "city"],
          description: "A postal address",
        },
      },
    };

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const resultJson = zodToJsonSchema(result);

    const expectedSchema = z.object({
      address: z
        .object({
          street: z.string().describe("Street name"),
          city: z.string().describe("City name"),
        })
        .describe("A postal address"),
    });
    const expectedJson = zodToJsonSchema(expectedSchema);

    expect(resultJson).toStrictEqual(expectedJson);
  });

  it("should handle circular $ref without crashing and return z.any()", () => {
    // A schema where Node references itself — this would cause infinite
    // recursion without cycle detection.
    const jsonSchema = {
      type: "object",
      properties: {
        root: { $ref: "#/$defs/Node" },
      },
      required: ["root"],
      $defs: {
        Node: {
          type: "object",
          properties: {
            value: { type: "string", description: "Node value" },
            child: { $ref: "#/$defs/Node" },
          },
          required: ["value"],
          description: "A tree node",
        },
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Must not throw or hang
    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    expect(result).toBeDefined();

    // The circular ref should have produced a console.warn
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Circular $ref detected"),
    );

    // The top-level shape should still have a "root" key that is an object
    const shape = (result as z.ZodObject<any>).shape;
    expect(shape.root).toBeDefined();

    // Inside root, "value" should be a string and "child" should be z.any()
    // (child is optional since it's not in required[], so unwrap ZodOptional)
    const rootShape = (shape.root as z.ZodObject<any>).shape;
    expect(rootShape.value._def.typeName).toBe("ZodString");
    const childDef = rootShape.child._def;
    if (childDef.typeName === "ZodOptional") {
      expect(childDef.innerType._def.typeName).toBe("ZodAny");
    } else {
      expect(childDef.typeName).toBe("ZodAny");
    }

    warnSpy.mockRestore();
  });

  it("should resolve the same $ref used by multiple sibling properties", () => {
    // Two properties reference the same $def — the visited set must NOT
    // mark the second usage as circular.
    const jsonSchema = {
      type: "object",
      properties: {
        billing: { $ref: "#/$defs/Address" },
        shipping: { $ref: "#/$defs/Address" },
      },
      required: ["billing", "shipping"],
      $defs: {
        Address: {
          type: "object",
          properties: {
            street: { type: "string", description: "Street" },
            city: { type: "string", description: "City" },
          },
          required: ["street", "city"],
          description: "An address",
        },
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const shape = (result as z.ZodObject<any>).shape;

    // Both should be fully resolved objects, NOT z.any()
    expect(shape.billing._def.typeName).toBe("ZodObject");
    expect(shape.shipping._def.typeName).toBe("ZodObject");

    // No circular-ref warning should have been emitted
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("should resolve a shared $ref used in different branches of a $ref chain", () => {
    // Wrapper -> Container (via $ref) which has two children both using $ref to Leaf.
    // Without set cloning, the second Leaf ref in Container would be wrongly flagged
    // as circular because the first Leaf resolution already added it to the set.
    const jsonSchema = {
      type: "object",
      properties: {
        wrapper: { $ref: "#/$defs/Container" },
      },
      required: ["wrapper"],
      $defs: {
        Container: {
          type: "object",
          properties: {
            first: { $ref: "#/$defs/Leaf" },
            second: { $ref: "#/$defs/Leaf" },
          },
          required: ["first", "second"],
          description: "A container with two leaves",
        },
        Leaf: {
          type: "object",
          properties: {
            label: { type: "string", description: "Leaf label" },
          },
          required: ["label"],
          description: "A leaf node",
        },
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const wrapperShape = (
      (result as z.ZodObject<any>).shape.wrapper as z.ZodObject<any>
    ).shape;

    // Both first and second should be fully resolved Leaf objects
    expect(wrapperShape.first._def.typeName).toBe("ZodObject");
    expect(wrapperShape.second._def.typeName).toBe("ZodObject");

    // No circular-ref warning should have been emitted
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("should handle anyOf with $ref variants", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        pet: {
          anyOf: [{ $ref: "#/$defs/Cat" }, { $ref: "#/$defs/Dog" }],
          description: "A pet",
        },
      },
      required: ["pet"],
      $defs: {
        Cat: {
          type: "object",
          properties: { meow: { type: "boolean" } },
          required: ["meow"],
        },
        Dog: {
          type: "object",
          properties: { bark: { type: "boolean" } },
          required: ["bark"],
        },
      },
    };

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    expect(result).toBeDefined();

    // Should produce a union inside the "pet" property
    const petSchema = (result as z.ZodObject<any>).shape.pet;
    expect(petSchema._def.typeName).toBe("ZodUnion");
  });

  it("should handle integer type as z.number()", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        count: { type: "integer", description: "A count" },
      },
      required: ["count"],
    };

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const shape = (result as z.ZodObject<any>).shape;
    expect(shape.count._def.typeName).toBe("ZodNumber");
  });

  it("should handle null type", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        empty: { type: "null", description: "Always null" },
      },
      required: ["empty"],
    };

    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const shape = (result as z.ZodObject<any>).shape;
    expect(shape.empty._def.typeName).toBe("ZodNull");
  });

  it("should warn and return z.any() for unsupported schema types", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const jsonSchema = { type: "custom_unsupported" };
    const result = convertJsonSchemaToZodSchema(jsonSchema, true);

    expect(result._def.typeName).toBe("ZodAny");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Unsupported JSON schema type "custom_unsupported"',
      ),
    );

    warnSpy.mockRestore();
  });
});

describe("jsonSchemaToActionParameters", () => {
  it("should convert a simple JSONSchema to Parameter array", () => {
    const jsonSchema: JSONSchema = {
      type: "object",
      properties: {
        name: { type: "string", description: "User name" },
        age: { type: "number", description: "User age" },
      },
      required: ["name"],
    };

    const expectedParameters: Parameter[] = [
      { name: "name", type: "string", description: "User name" },
      { name: "age", type: "number", description: "User age", required: false },
    ];

    const result = jsonSchemaToActionParameters(jsonSchema);
    expect(result).toEqual(expectedParameters);
  });

  it("should convert JSONSchema with enum to Parameter array", () => {
    const jsonSchema: JSONSchema = {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["admin", "user", "guest"],
          description: "User role",
        },
      },
      required: ["role"],
    };

    const expectedParameters: Parameter[] = [
      {
        name: "role",
        type: "string",
        enum: ["admin", "user", "guest"],
        description: "User role",
      },
    ];

    const result = jsonSchemaToActionParameters(jsonSchema);
    expect(result).toEqual(expectedParameters);
  });

  it("should convert nested object JSONSchema to Parameter array", () => {
    const jsonSchema: JSONSchema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: { type: "string", description: "User name" },
            age: { type: "number", description: "User age" },
          },
          required: ["name"],
          description: "User information",
        },
      },
      required: ["user"],
    };

    const expectedParameters: Parameter[] = [
      {
        name: "user",
        type: "object",
        description: "User information",
        attributes: [
          { name: "name", type: "string", description: "User name" },
          {
            name: "age",
            type: "number",
            description: "User age",
            required: false,
          },
        ],
      },
    ];

    const result = jsonSchemaToActionParameters(jsonSchema);
    expect(result).toEqual(expectedParameters);
  });

  it("should convert array JSONSchema to Parameter array", () => {
    const jsonSchema: JSONSchema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "User tags",
        },
      },
      required: ["tags"],
    };

    const expectedParameters: Parameter[] = [
      { name: "tags", type: "string[]", description: "User tags" },
    ];

    const result = jsonSchemaToActionParameters(jsonSchema);
    expect(result).toEqual(expectedParameters);
  });

  it("should convert object array JSONSchema to Parameter array", () => {
    const jsonSchema: JSONSchema = {
      type: "object",
      properties: {
        addresses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              street: { type: "string", description: "Street name" },
              city: { type: "string", description: "City name" },
            },
            required: ["street"],
          },
          description: "User addresses",
        },
      },
      required: ["addresses"],
    };

    const expectedParameters: Parameter[] = [
      {
        name: "addresses",
        type: "object[]",
        description: "User addresses",
        attributes: [
          { name: "street", type: "string", description: "Street name" },
          {
            name: "city",
            type: "string",
            description: "City name",
            required: false,
          },
        ],
      },
    ];

    const result = jsonSchemaToActionParameters(jsonSchema);
    expect(result).toEqual(expectedParameters);
  });

  it("should handle boolean types", () => {
    const jsonSchema: JSONSchema = {
      type: "object",
      properties: {
        isAdmin: { type: "boolean", description: "Is user an admin" },
      },
      required: ["isAdmin"],
    };

    const expectedParameters: Parameter[] = [
      { name: "isAdmin", type: "boolean", description: "Is user an admin" },
    ];

    const result = jsonSchemaToActionParameters(jsonSchema);
    expect(result).toEqual(expectedParameters);
  });

  it("should handle empty object schema", () => {
    const jsonSchema: JSONSchema = {
      type: "object",
    };

    const expectedParameters: Parameter[] = [];

    const result = jsonSchemaToActionParameters(jsonSchema);
    expect(result).toEqual(expectedParameters);
  });

  it("should throw error for nested arrays", () => {
    const jsonSchema: JSONSchema = {
      type: "object",
      properties: {
        nestedArray: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description: "Matrix of strings",
        },
      },
      required: ["nestedArray"],
    };

    expect(() => jsonSchemaToActionParameters(jsonSchema)).toThrow(
      "Nested arrays are not supported",
    );
  });

  it("should handle null-union type ['string', 'null'] as optional string", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        nickname: {
          type: ["string", "null"],
          description: "Optional nickname",
        },
      },
      required: ["nickname"],
    };

    const result = jsonSchemaToActionParameters(jsonSchema as any);
    expect(result).toEqual([
      {
        name: "nickname",
        type: "string",
        description: "Optional nickname",
        required: false,
      },
    ]);
  });

  it("should handle null-union type ['object', 'null'] preserving properties", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        metadata: {
          type: ["object", "null"],
          description: "Optional metadata",
          properties: {
            key: { type: "string" },
          },
          required: ["key"],
        },
      },
      required: ["metadata"],
    };

    const result = jsonSchemaToActionParameters(jsonSchema as any);
    expect(result).toEqual([
      {
        name: "metadata",
        type: "object",
        description: "Optional metadata",
        required: false,
        attributes: [{ name: "key", type: "string", description: undefined }],
      },
    ]);
  });

  it("should handle null-union type when field is already optional", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        nickname: {
          type: ["string", "null"],
          description: "Optional nickname",
        },
      },
      // nickname is NOT in required
    };

    const result = jsonSchemaToActionParameters(jsonSchema as any);
    expect(result).toEqual([
      {
        name: "nickname",
        type: "string",
        description: "Optional nickname",
        required: false,
      },
    ]);
  });

  it("should handle type array with only 'null' by falling back to string", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        weird: {
          type: ["null"],
          description: "Null-only type",
        },
      },
      required: ["weird"],
    };

    const result = jsonSchemaToActionParameters(jsonSchema as any);
    expect(result).toEqual([
      {
        name: "weird",
        type: "string",
        description: "Null-only type",
        required: false,
      },
    ]);
  });

  it("should ensure round-trip conversion works", () => {
    const originalParameters: Parameter[] = [
      { name: "name", type: "string", description: "User name" },
      { name: "age", type: "number", description: "User age", required: false },
      {
        name: "role",
        type: "string",
        enum: ["admin", "user"],
        description: "User role",
      },
      {
        name: "address",
        type: "object",
        description: "User address",
        attributes: [
          { name: "street", type: "string", description: "Street name" },
          { name: "city", type: "string", description: "City name" },
        ],
      },
      {
        name: "contacts",
        type: "object[]",
        description: "User contacts",
        attributes: [
          { name: "type", type: "string", description: "Contact type" },
          { name: "value", type: "string", description: "Contact value" },
        ],
      },
    ];

    const jsonSchema = actionParametersToJsonSchema(originalParameters);
    const roundTripParameters = jsonSchemaToActionParameters(jsonSchema);

    expect(roundTripParameters).toEqual(originalParameters);
  });
});
