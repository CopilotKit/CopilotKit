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

export function actionParametersToJsonSchema(
  actionParameters: Parameter[],
): JSONSchema {
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
export function jsonSchemaToActionParameters(
  jsonSchema: JSONSchema,
): Parameter[] {
  if (jsonSchema.type !== "object" || !jsonSchema.properties) {
    return [];
  }

  const parameters: Parameter[] = [];
  const requiredFields = jsonSchema.required || [];

  for (const [name, schema] of Object.entries(jsonSchema.properties)) {
    const parameter = convertJsonSchemaToParameter(
      name,
      schema,
      requiredFields.includes(name),
    );
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

        for (const [propName, propSchema] of Object.entries(
          schema.properties,
        )) {
          attributes.push(
            convertJsonSchemaToParameter(
              propName,
              propSchema,
              requiredFields.includes(propName),
            ),
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

        for (const [propName, propSchema] of Object.entries(
          schema.items.properties || {},
        )) {
          attributes.push(
            convertJsonSchemaToParameter(
              propName,
              propSchema,
              requiredFields.includes(propName),
            ),
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

export function convertJsonSchemaToZodSchema(
  jsonSchema: any,
  required: boolean,
  definitions?: Record<string, any>,
  visitedRefs?: Set<string>,
): z.ZodSchema {
  // Resolve $ref references
  if (jsonSchema.$ref && definitions) {
    const refPath = jsonSchema.$ref.replace(
      /^#\/\$defs\/|^#\/definitions\//,
      "",
    );

    // Detect circular $ref cycles
    const refs = visitedRefs ?? new Set<string>();
    if (refs.has(refPath)) {
      console.warn(
        `[CopilotKit] Circular $ref detected for "${refPath}" — falling back to z.any()`,
      );
      let schema = z.any();
      if (jsonSchema.description) {
        schema = schema.describe(jsonSchema.description);
      }
      return required ? schema : schema.optional();
    }

    const resolved = definitions[refPath];
    if (resolved) {
      // Clone the set so sibling branches don't see each other's visited refs
      const nextRefs = new Set(refs);
      nextRefs.add(refPath);
      return convertJsonSchemaToZodSchema(
        resolved,
        required,
        definitions,
        nextRefs,
      );
    }
  }

  // Collect top-level definitions for $ref resolution
  const defs = definitions ?? jsonSchema.$defs ?? jsonSchema.definitions;

  // Handle anyOf / oneOf as z.union
  const unionVariants = jsonSchema.anyOf ?? jsonSchema.oneOf;
  if (Array.isArray(unionVariants) && unionVariants.length > 0) {
    if (unionVariants.length === 1) {
      return convertJsonSchemaToZodSchema(
        unionVariants[0],
        required,
        defs,
        visitedRefs,
      );
    }
    const schemas = unionVariants.map((v: any) =>
      convertJsonSchemaToZodSchema(v, true, defs, visitedRefs),
    );
    let schema = z.union(
      schemas as [z.ZodSchema, z.ZodSchema, ...z.ZodSchema[]],
    );
    if (jsonSchema.description) {
      schema = schema.describe(jsonSchema.description);
    }
    return required ? schema : schema.optional();
  }

  if (jsonSchema.type === "object") {
    const spec: { [key: string]: z.ZodSchema } = {};

    if (!jsonSchema.properties || !Object.keys(jsonSchema.properties).length) {
      return !required ? z.object(spec).optional() : z.object(spec);
    }

    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      spec[key] = convertJsonSchemaToZodSchema(
        value,
        jsonSchema.required ? jsonSchema.required.includes(key) : false,
        defs,
        visitedRefs,
      );
    }
    let schema = z.object(spec).describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "string") {
    if (jsonSchema.enum && jsonSchema.enum.length > 0) {
      let schema = z
        .enum(jsonSchema.enum as [string, ...string[]])
        .describe(jsonSchema.description);
      return required ? schema : schema.optional();
    }
    let schema = z.string().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "number" || jsonSchema.type === "integer") {
    let schema = z.number().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "boolean") {
    let schema = z.boolean().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "array") {
    let itemSchema = convertJsonSchemaToZodSchema(
      jsonSchema.items,
      true,
      defs,
      visitedRefs,
    );
    let schema = z.array(itemSchema).describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "null") {
    let schema = z.null().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  }

  // Fallback: accept any value rather than throwing
  console.warn(
    `[CopilotKit] Unsupported JSON schema type "${jsonSchema.type ?? "unknown"}" — falling back to z.any()`,
  );
  let schema = z.any();
  if (jsonSchema.description) {
    schema = schema.describe(jsonSchema.description);
  }
  return required ? schema : schema.optional();
}

export function getZodParameters<T extends [] | Parameter[] | undefined>(
  parameters: T,
): any {
  if (!parameters) return z.object({});
  const jsonParams = actionParametersToJsonSchema(parameters);
  return convertJsonSchemaToZodSchema(jsonParams, true);
}
