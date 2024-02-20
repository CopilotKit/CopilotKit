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
  let properties: { [key: string]: any } = {};
  let required: string[] | undefined = undefined;

  switch (attribute.type) {
    case undefined:
      return {
        type: "string",
        description: attribute.description,
      };
    case "string":
      return {
        type: "string",
        description: attribute.description,
        ...(attribute.enum ? { enum: attribute.enum } : {}),
      };
    case "number":
    case "boolean":
      return {
        type: attribute.type,
        description: attribute.description,
      };
    case "object":
      properties = attribute.attributes?.reduce((acc, attr) => {
        acc[attr.name] = convertAttribute(attr);
        return acc;
      }, {} as any);
      required = attribute.attributes
        ?.filter((attr) => attr.required !== false)
        .map((attr) => attr.name);
      return {
        type: "object",
        description: attribute.description,
        ...(properties ? { properties } : {}),
        ...(required && required.length != 0 ? { required } : {}),
      };
    case "string[]":
      return {
        type: "array",
        items: {
          type: "string",
        },
        description: attribute.description,
      };
    case "number[]":
      return {
        type: "array",
        items: {
          type: "number",
        },
        description: attribute.description,
      };
    case "boolean[]":
      return {
        type: "array",
        items: {
          type: "boolean",
        },
        description: attribute.description,
      };
    case "object[]":
      properties = attribute.attributes?.reduce((acc, attr) => {
        acc[attr.name] = convertAttribute(attr);
        return acc;
      }, {} as any);
      required = attribute.attributes
        ?.filter((attr) => attr.required !== false)
        .map((attr) => attr.name);
      return {
        type: "array",
        items: {
          type: "object",
          ...(properties ? { properties } : {}),
          ...(required && required.length != 0 ? { required } : {}),
        },
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
