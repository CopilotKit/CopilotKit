"use client";

import { Function } from "@copilotkit/shared";
import { useCallback, useState } from "react";
import { CopilotContext, CopilotApiConfig } from "../../context/copilot-context";
import useTree from "../../hooks/use-tree";
import { DocumentPointer } from "../../types";
import {
  FunctionCallHandler,
  AnnotatedFunction,
  annotatedFunctionToChatCompletionFunction,
} from "@copilotkit/shared";
import useFlatCategoryStore from "../../hooks/use-flat-category-store";
import { StandardCopilotApiConfig } from "./standard-copilot-api-config";
import { CopilotKitProps } from "./copilotkit-props";

/**
 * The CopilotKit component.
 * This component provides the Copilot context to its children.
 * It can be configured either with a chat API endpoint or a CopilotApiConfig.
 *
 * NOTE: The backend can use OpenAI, or you can bring your own LLM.
 * For examples of the backend api implementation, see `examples/next-openai` usage (under `src/api/copilotkit`),
 * or read the documentation at https://docs.copilotkit.ai
 * In particular, Getting-Started > Quickstart-Backend: https://docs.copilotkit.ai/getting-started/quickstart-backend
 *
 * Example usage:
 * ```
 * <CopilotKit url="https://your.copilotkit.api">
 *    <App />
 * </CopilotKit>
 * ```
 *
 * or
 *
 * ```
 * const copilotApiConfig = new StandardCopilotApiConfig(
 *  "https://your.copilotkit.api/v1",
 *  "https://your.copilotkit.api/v2",
 *  {},
 *  {}
 *  );
 *
 * // ...
 *
 * <CopilotKit chatApiConfig={copilotApiConfig}>
 *    <App />
 * </CopilotKit>
 * ```
 *
 * @param props - The props for the component.
 * @returns The CopilotKit component.
 */
export function CopilotKit({ children, ...props }: CopilotKitProps) {
  // Compute all the functions and properties that we need to pass
  // to the CopilotContext.

  const [entryPoints, setEntryPoints] = useState<Record<string, AnnotatedFunction<any[]>>>({});

  const { addElement, removeElement, printTree } = useTree();

  const {
    addElement: addDocument,
    removeElement: removeDocument,
    allElements: allDocuments,
  } = useFlatCategoryStore<DocumentPointer>();

  const setEntryPoint = useCallback((id: string, entryPoint: AnnotatedFunction<any[]>) => {
    setEntryPoints((prevPoints) => {
      return {
        ...prevPoints,
        [id]: entryPoint,
      };
    });
  }, []);

  const removeEntryPoint = useCallback((id: string) => {
    setEntryPoints((prevPoints) => {
      const newPoints = { ...prevPoints };
      delete newPoints[id];
      return newPoints;
    });
  }, []);

  const getContextString = useCallback(
    (documents: DocumentPointer[], categories: string[]) => {
      const documentsString = documents
        .map((document) => {
          return `${document.name} (${document.sourceApplication}):\n${document.getContents()}`;
        })
        .join("\n\n");

      const nonDocumentStrings = printTree(categories);

      return `${documentsString}\n\n${nonDocumentStrings}`;
    },
    [printTree],
  );

  const addContext = useCallback(
    (
      context: string,
      parentId?: string,
      categories: string[] = defaultCopilotContextCategories,
    ) => {
      return addElement(context, categories, parentId);
    },
    [addElement],
  );

  const removeContext = useCallback(
    (id: string) => {
      removeElement(id);
    },
    [removeElement],
  );

  const getChatCompletionFunctionDescriptions = useCallback(() => {
    return entryPointsToChatCompletionFunctions(Object.values(entryPoints));
  }, [entryPoints]);

  const getFunctionCallHandler = useCallback(() => {
    return entryPointsToFunctionCallHandler(Object.values(entryPoints));
  }, [entryPoints]);

  const getDocumentsContext = useCallback(
    (categories: string[]) => {
      return allDocuments(categories);
    },
    [allDocuments],
  );

  const addDocumentContext = useCallback(
    (documentPointer: DocumentPointer, categories: string[] = defaultCopilotContextCategories) => {
      return addDocument(documentPointer, categories);
    },
    [addDocument],
  );

  const removeDocumentContext = useCallback(
    (documentId: string) => {
      removeDocument(documentId);
    },
    [removeDocument],
  );

  // get the appropriate CopilotApiConfig from the props
  const copilotApiConfig: CopilotApiConfig = new StandardCopilotApiConfig(
    props.url,
    `${props.url}/v2`,
    props.headers || {},
    props.body || {},
  );

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
        getDocumentsContext,
        addDocumentContext,
        removeDocumentContext,
        copilotApiConfig: copilotApiConfig,
      }}
    >
      {children}
    </CopilotContext.Provider>
  );
}

export const defaultCopilotContextCategories = ["global"];

function entryPointsToFunctionCallHandler(
  entryPoints: AnnotatedFunction<any[]>[],
): FunctionCallHandler {
  return async (chatMessages, functionCall) => {
    let entrypointsByFunctionName: Record<string, AnnotatedFunction<any[]>> = {};
    for (let entryPoint of entryPoints) {
      entrypointsByFunctionName[entryPoint.name] = entryPoint;
    }

    const entryPointFunction = entrypointsByFunctionName[functionCall.name || ""];
    if (entryPointFunction) {
      let functionCallArguments: Record<string, any>[] = [];
      if (functionCall.arguments) {
        functionCallArguments = JSON.parse(functionCall.arguments);
      }

      const paramsInCorrectOrder: any[] = [];
      for (let arg of entryPointFunction.argumentAnnotations) {
        paramsInCorrectOrder.push(
          functionCallArguments[arg.name as keyof typeof functionCallArguments],
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

function entryPointsToChatCompletionFunctions(entryPoints: AnnotatedFunction<any[]>[]): Function[] {
  return entryPoints.map(annotatedFunctionToChatCompletionFunction);
}
