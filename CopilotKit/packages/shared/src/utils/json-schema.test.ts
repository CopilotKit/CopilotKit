import { z } from "zod";
import { convertJsonSchemaToZodSchema } from "../utils/json-schema";
import { zodToJsonSchema } from "zod-to-json-schema";

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
});
