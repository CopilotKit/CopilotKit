"use client";
import { FunctionCallHandler } from "ai";
import { ReactNode, useCallback, useState } from "react";
import { CopilotContext, CopilotApiConfig } from "../context/copilot-context";
import useTree from "../hooks/use-tree";
import { AnnotatedFunction } from "../types/annotated-function";
import { ChatCompletionCreateParams } from "openai/resources/chat";

export function CopilotProvider({
  copilotApiConfig,
  children,
}: {
  copilotApiConfig: CopilotApiConfig;
  children: ReactNode;
}): JSX.Element {
  const [entryPoints, setEntryPoints] = useState<
    Record<string, AnnotatedFunction<any[]>>
  >({});

  const { addElement, removeElement, printTree } = useTree();

  const setEntryPoint = useCallback(
    (id: string, entryPoint: AnnotatedFunction<any[]>) => {
      setEntryPoints((prevPoints) => {
        return {
          ...prevPoints,
          [id]: entryPoint,
        };
      });
    },
    []
  );

  const removeEntryPoint = useCallback((id: string) => {
    setEntryPoints((prevPoints) => {
      const newPoints = { ...prevPoints };
      delete newPoints[id];
      return newPoints;
    });
  }, []);

  const getContextString = useCallback(
    (categories: string[] = ["global"]) => {
      return printTree(categories);
    },
    [printTree]
  );

  const addContext = useCallback(
    (context: string, parentId?: string, categories: string[] = ["global"]) => {
      return addElement(context, categories, parentId);
    },
    [addElement]
  );

  const removeContext = useCallback(
    (id: string) => {
      removeElement(id);
    },
    [removeElement]
  );

  const getChatCompletionFunctionDescriptions = useCallback(() => {
    return entryPointsToChatCompletionFunctions(Object.values(entryPoints));
  }, [entryPoints]);

  const getFunctionCallHandler = useCallback(() => {
    return entryPointsToFunctionCallHandler(Object.values(entryPoints));
  }, [entryPoints]);

  return (
    <CopilotContext.Provider
      value={{
        entryPoints,
        getChatCompletionFunctionDescriptions,
        getFunctionCallHandler,
        setEntryPoint,
        removeEntryPoint,
        getContextString,
        addContext,
        removeContext,

        copilotApiConfig,
      }}
    >
      {children}
    </CopilotContext.Provider>
  );
}

function entryPointsToFunctionCallHandler(
  entryPoints: AnnotatedFunction<any[]>[]
): FunctionCallHandler {
  return async (chatMessages, functionCall) => {
    let entrypointsByFunctionName: Record<
      string,
      AnnotatedFunction<any[]>
    > = {};
    for (let entryPoint of entryPoints) {
      entrypointsByFunctionName[entryPoint.name] = entryPoint;
    }

    const entryPointFunction =
      entrypointsByFunctionName[functionCall.name || ""];
    if (entryPointFunction) {
      let parsedFunctionCallArguments: Record<string, any>[] = [];
      if (functionCall.arguments) {
        parsedFunctionCallArguments = JSON.parse(functionCall.arguments);
      }

      const paramsInCorrectOrder: any[] = [];
      for (let arg of entryPointFunction.argumentAnnotations) {
        paramsInCorrectOrder.push(
          parsedFunctionCallArguments[
            arg.name as keyof typeof parsedFunctionCallArguments
          ]
        );
      }

      await entryPointFunction.implementation(...paramsInCorrectOrder);

      // commented out becasue for now we don't want to return anything
      // const result = await entryPointFunction.implementation(
      //   ...parsedFunctionCallArguments
      // );
      // const functionResponse: ChatRequest = {
      //   messages: [
      //     ...chatMessages,
      //     {
      //       id: nanoid(),
      //       name: functionCall.name,
      //       role: 'function' as const,
      //       content: JSON.stringify(result),
      //     },
      //   ],
      // };

      // return functionResponse;
    }
  };
}

function entryPointsToChatCompletionFunctions(
  entryPoints: AnnotatedFunction<any[]>[]
): ChatCompletionCreateParams.Function[] {
  return entryPoints.map(annotatedFunctionToChatCompletionFunction);
}

function annotatedFunctionToChatCompletionFunction(
  annotatedFunction: AnnotatedFunction<any[]>
): ChatCompletionCreateParams.Function {
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
  let chatCompletionFunction: ChatCompletionCreateParams.Function = {
    name: annotatedFunction.name,
    description: annotatedFunction.description,
    parameters: {
      type: "object",
      properties: parameters,
      required: requiredParameterNames,
    },
  };

  return chatCompletionFunction;
}
