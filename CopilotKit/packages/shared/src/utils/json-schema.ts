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
