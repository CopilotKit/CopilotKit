import { z } from "zod";
import { Parameter } from "../types";

export type JSONSchemaString = {
  type: "string";
  description?: string;
  enum?: string[];
};

export type JSONSchemaNumber = {
  type: "number";
  description?: string;
};

export type JSONSchemaBoolean = {
  type: "boolean";
  description?: string;
};

export type JSONSchemaObject = {
  type: "object";
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
};

export type JSONSchemaArray = {
  type: "array";
  items: JSONSchema;
  description?: string;
};

export type JSONSchema =
  | JSONSchemaString
  | JSONSchemaNumber
  | JSONSchemaBoolean
  | JSONSchemaObject
  | JSONSchemaArray;

export function actionParametersToJsonSchema(actionParameters: Parameter[]): JSONSchema {
  // Create the parameters object based on the argumentAnnotations
  let parameters: { [key: string]: any } = {};
  for (let parameter of actionParameters || []) {
    parameters[parameter.name] = convertAttribute(parameter);
  }

  let requiredParameterNames: string[] = [];
  for (let arg of actionParameters || []) {
    if (arg.required !== false) {
      requiredParameterNames.push(arg.name);
    }
  }

  // Create the ChatCompletionFunctions object
  return {
    type: "object",
    properties: parameters,
    required: requiredParameterNames,
  };
}

// Convert JSONSchema to Parameter[]
export function jsonSchemaToActionParameters(jsonSchema: JSONSchema): Parameter[] {
  if (jsonSchema.type !== "object" || !jsonSchema.properties) {
    return [];
  }

  const parameters: Parameter[] = [];
  const requiredFields = jsonSchema.required || [];

  for (const [name, schema] of Object.entries(jsonSchema.properties)) {
    const parameter = convertJsonSchemaToParameter(name, schema, requiredFields.includes(name));
    parameters.push(parameter);
  }

  return parameters;
}

// Convert JSONSchema property to Parameter
function convertJsonSchemaToParameter(
  name: string,
  schema: JSONSchema,
  isRequired: boolean,
): Parameter {
  const baseParameter: Parameter = {
    name,
    description: schema.description,
  };

  if (!isRequired) {
    baseParameter.required = false;
  }

  switch (schema.type) {
    case "string":
      return {
        ...baseParameter,
        type: "string",
        ...(schema.enum && { enum: schema.enum }),
      };
    case "number":
    case "boolean":
      return {
        ...baseParameter,
        type: schema.type,
      };
    case "object":
      if (schema.properties) {
        const attributes: Parameter[] = [];
        const requiredFields = schema.required || [];

        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          attributes.push(
            convertJsonSchemaToParameter(propName, propSchema, requiredFields.includes(propName)),
          );
        }

        return {
          ...baseParameter,
          type: "object",
          attributes,
        };
      }
      return {
        ...baseParameter,
        type: "object",
      };
    case "array":
      if (schema.items.type === "object" && "properties" in schema.items) {
        const attributes: Parameter[] = [];
        const requiredFields = schema.items.required || [];

        for (const [propName, propSchema] of Object.entries(schema.items.properties || {})) {
          attributes.push(
            convertJsonSchemaToParameter(propName, propSchema, requiredFields.includes(propName)),
          );
        }

        return {
          ...baseParameter,
          type: "object[]",
          attributes,
        };
      } else if (schema.items.type === "array") {
        throw new Error("Nested arrays are not supported");
      } else {
        return {
          ...baseParameter,
          type: `${schema.items.type}[]`,
        };
      }
    default:
      return {
        ...baseParameter,
        type: "string",
      };
  }
}

function convertAttribute(attribute: Parameter): JSONSchema {
  switch (attribute.type) {
    case "string":
      return {
        type: "string",
        description: attribute.description,
        ...(attribute.enum && { enum: attribute.enum }),
      };
    case "number":
    case "boolean":
      return {
        type: attribute.type,
        description: attribute.description,
      };
    case "object":
    case "object[]":
      const properties = attribute.attributes?.reduce(
        (acc, attr) => {
          acc[attr.name] = convertAttribute(attr);
          return acc;
        },
        {} as Record<string, any>,
      );
      const required = attribute.attributes
        ?.filter((attr) => attr.required !== false)
        .map((attr) => attr.name);
      if (attribute.type === "object[]") {
        return {
          type: "array",
          items: {
            type: "object",
            ...(properties && { properties }),
            ...(required && required.length > 0 && { required }),
          },
          description: attribute.description,
        };
      }
      return {
        type: "object",
        description: attribute.description,
        ...(properties && { properties }),
        ...(required && required.length > 0 && { required }),
      };
    default:
      // Handle arrays of primitive types and undefined attribute.type
      if (attribute.type?.endsWith("[]")) {
        const itemType = attribute.type.slice(0, -2);
        return {
          type: "array",
          items: { type: itemType as any },
          description: attribute.description,
        };
      }
      // Fallback for undefined type or any other unexpected type
      return {
        type: "string",
        description: attribute.description,
      };
  }
}

export function convertJsonSchemaToZodSchema(jsonSchema: any, required: boolean): z.ZodSchema {
  if (jsonSchema.type === "object") {
    const spec: { [key: string]: z.ZodSchema } = {};

    if (!jsonSchema.properties || !Object.keys(jsonSchema.properties).length) {
      return !required ? z.object(spec).optional() : z.object(spec);
    }

    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      spec[key] = convertJsonSchemaToZodSchema(
        value,
        jsonSchema.required ? jsonSchema.required.includes(key) : false,
      );
    }
    let schema = z.object(spec).describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "string") {
    let schema = z.string().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "number") {
    let schema = z.number().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "boolean") {
    let schema = z.boolean().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "array") {
    let itemSchema = convertJsonSchemaToZodSchema(jsonSchema.items, true);
    let schema = z.array(itemSchema).describe(jsonSchema.description);
    return required ? schema : schema.optional();
  }
  throw new Error("Invalid JSON schema");
}
