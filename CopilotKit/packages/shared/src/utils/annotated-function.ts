import { Action, AnnotatedFunction, ToolDefinition, Parameter } from "../types";

export function annotatedFunctionToChatCompletionFunction(
  annotatedFunction: AnnotatedFunction<any[]>,
): ToolDefinition {
  // Create the parameters object based on the argumentAnnotations
  let parameters: { [key: string]: any } = {};
  for (let arg of annotatedFunction.argumentAnnotations) {
    // isolate the args we should forward inline
    let { name, required, ...forwardedArgs } = arg;
    parameters[arg.name] = forwardedArgs;
  }

  let requiredParameterNames: string[] = [];
  for (let arg of annotatedFunction.argumentAnnotations) {
    if (arg.required) {
      requiredParameterNames.push(arg.name);
    }
  }

  // Create the ChatCompletionFunctions object
  let chatCompletionFunction: ToolDefinition = {
    type: "function",
    function: {
      name: annotatedFunction.name,
      description: annotatedFunction.description,
      parameters: {
        type: "object",
        properties: parameters,
        required: requiredParameterNames,
      },
    },
  };

  return chatCompletionFunction;
}

function convertAttribute(attribute: Parameter): any {
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
          items: { type: itemType },
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

export function actionToChatCompletionFunction(action: Action<any>): ToolDefinition {
  // Create the parameters object based on the argumentAnnotations
  let parameters: { [key: string]: any } = {};
  for (let parameter of action.parameters || []) {
    parameters[parameter.name] = convertAttribute(parameter);
  }

  let requiredParameterNames: string[] = [];
  for (let arg of action.parameters || []) {
    if (arg.required !== false) {
      requiredParameterNames.push(arg.name);
    }
  }

  // Create the ChatCompletionFunctions object
  let chatCompletionFunction: ToolDefinition = {
    type: "function",
    function: {
      name: action.name,
      ...(action.description && { description: action.description }),
      parameters: {
        type: "object",
        properties: parameters,
        required: requiredParameterNames,
      },
    },
  };

  return chatCompletionFunction;
}

export function annotatedFunctionToAction(
  annotatedFunction: AnnotatedFunction<any[]>,
): Action<any> {
  const parameters: Parameter[] = annotatedFunction.argumentAnnotations.map((annotation) => {
    switch (annotation.type) {
      case "string":
      case "number":
      case "boolean":
      case "object":
        return {
          name: annotation.name,
          description: annotation.description,
          type: annotation.type,
          required: annotation.required,
        };
      case "array":
        let type;
        if (annotation.items.type === "string") {
          type = "string[]";
        } else if (annotation.items.type === "number") {
          type = "number[]";
        } else if (annotation.items.type === "boolean") {
          type = "boolean[]";
        } else if (annotation.items.type === "object") {
          type = "object[]";
        } else {
          type = "string[]";
        }
        return {
          name: annotation.name,
          description: annotation.description,
          type: type as any,
          required: annotation.required,
        };
    }
  });

  return {
    name: annotatedFunction.name,
    description: annotatedFunction.description,
    parameters: parameters,
    handler: (args) => {
      const paramsInCorrectOrder: any[] = [];
      for (let arg of annotatedFunction.argumentAnnotations) {
        paramsInCorrectOrder.push(args[arg.name]);
      }
      return annotatedFunction.implementation(...paramsInCorrectOrder);
    },
  };
}
