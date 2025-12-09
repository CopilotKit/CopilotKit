import { z } from "zod";
import {
  convertJsonSchemaToZodSchema,
  actionParametersToJsonSchema,
  jsonSchemaToActionParameters,
  JSONSchema,
} from "../utils/json-schema";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Parameter } from "../types";

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
        role: { type: "string", enum: ["admin", "user", "guest"], description: "User role" },
      },
      required: ["role"],
    };

    const expectedParameters: Parameter[] = [
      { name: "role", type: "string", enum: ["admin", "user", "guest"], description: "User role" },
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
          { name: "age", type: "number", description: "User age", required: false },
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
          { name: "city", type: "string", description: "City name", required: false },
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

  it("should ensure round-trip conversion works", () => {
    const originalParameters: Parameter[] = [
      { name: "name", type: "string", description: "User name" },
      { name: "age", type: "number", description: "User age", required: false },
      { name: "role", type: "string", enum: ["admin", "user"], description: "User role" },
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
