import { describe, it, expect } from "vitest";
import type { JSONSchema } from "../json-schema";
import {
  actionParametersToJsonSchema,
  jsonSchemaToActionParameters,
} from "../json-schema";
import type { Parameter } from "../../types";

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
