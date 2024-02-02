import { AnnotatedFunction, FunctionDefinition, ToolDefinition } from "../types";

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
