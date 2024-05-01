import { Ref, useCallback, useRef, useState } from "react";
import {
  CopilotContext,
  CopilotApiConfig,
  InChatRenderFunction,
} from "../../context/copilot-context";
import useTree from "../../hooks/use-tree";
import { DocumentPointer } from "../../types";
import {
  COPILOT_CLOUD_CHAT_URL,
  CopilotCloudConfig,
  FunctionCallHandler,
  Message,
  actionToChatCompletionFunction,
} from "@copilotkit/shared";
import { FrontendAction } from "../../types/frontend-action";
import useFlatCategoryStore from "../../hooks/use-flat-category-store";
import { CopilotKitProps } from "./copilotkit-props";
import { ToolDefinition } from "@copilotkit/shared";

/**
 * The CopilotKit component.
 * This component provides the Copilot context to its children.
 * It can be configured either with a chat API endpoint or a CopilotApiConfig.
 *
 * NOTE: The backend can use OpenAI, or you can bring your own LLM.
 * For examples of the backend api implementation, see `examples/next-openai` usage (under `src/api/copilotkit`),
 * or read the documentation at https://docs.copilotkit.ai
 * In particular, Getting-Started > Quickstart-Runtime: https://docs.copilotkit.ai/getting-started/quickstart-runtime
 *
 * Example usage:
 * ```
 * <CopilotKit url="https://your.copilotkit.api">
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

  if (!props.runtimeUrl && !props.url && !props.publicApiKey) {
    throw new Error("Please provide either a url or a publicApiKey to the CopilotKit component.");
  }

  const chatApiEndpoint = props.runtimeUrl || props.url || COPILOT_CLOUD_CHAT_URL;

  const [entryPoints, setEntryPoints] = useState<Record<string, FrontendAction<any>>>({});
  const chatComponentsCache = useRef<Record<string, InChatRenderFunction | string>>({});
  const { addElement, removeElement, printTree } = useTree();
  const [messages, setMessages] = useState<Message[]>([]);

  const {
    addElement: addDocument,
    removeElement: removeDocument,
    allElements: allDocuments,
  } = useFlatCategoryStore<DocumentPointer>();

  const setEntryPoint = useCallback((id: string, entryPoint: FrontendAction<any>) => {
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

  const getChatCompletionFunctionDescriptions = useCallback(
    (customEntryPoints?: Record<string, FrontendAction<any>>) => {
      return entryPointsToChatCompletionFunctions(Object.values(customEntryPoints || entryPoints));
    },
    [entryPoints],
  );

  const getFunctionCallHandler = useCallback(
    (customEntryPoints?: Record<string, FrontendAction<any>>) => {
      return entryPointsToFunctionCallHandler(Object.values(customEntryPoints || entryPoints));
    },
    [entryPoints],
  );

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

  if (!props.publicApiKey) {
    if (props.cloudRestrictToTopic) {
      throw new Error(
        "To use the cloudRestrictToTopic feature, please sign up at https://copilotkit.ai and provide a publicApiKey.",
      );
    }
  }

  let cloud: CopilotCloudConfig | undefined = undefined;
  if (props.publicApiKey) {
    cloud = {
      guardrails: {
        input: {
          restrictToTopic: {
            enabled: props.cloudRestrictToTopic ? true : false,
            validTopics: props.cloudRestrictToTopic?.validTopics || [],
            invalidTopics: props.cloudRestrictToTopic?.invalidTopics || [],
          },
        },
      },
    };
  }

  // get the appropriate CopilotApiConfig from the props
  const copilotApiConfig: CopilotApiConfig = {
    publicApiKey: props.publicApiKey,
    ...(cloud ? { cloud } : {}),
    chatApiEndpoint: chatApiEndpoint,
    chatApiEndpointV2: `${props.url}/v2`,
    headers: props.headers || {},
    body: {
      ...props.body,
      ...props.backendOnlyProps,
    },
  };

  return (
    <CopilotContext.Provider
      value={{
        entryPoints,
        chatComponentsCache,
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
        messages,
        setMessages,
      }}
    >
      {children}
    </CopilotContext.Provider>
  );
}

export const defaultCopilotContextCategories = ["global"];

function entryPointsToChatCompletionFunctions(actions: FrontendAction<any>[]): ToolDefinition[] {
  return actions.map(actionToChatCompletionFunction);
}

function entryPointsToFunctionCallHandler(actions: FrontendAction<any>[]): FunctionCallHandler {
  return async (chatMessages, functionCall) => {
    let actionsByFunctionName: Record<string, FrontendAction<any>> = {};
    for (let action of actions) {
      actionsByFunctionName[action.name] = action;
    }

    const action = actionsByFunctionName[functionCall.name || ""];
    if (action) {
      let functionCallArguments: Record<string, any>[] = [];
      if (functionCall.arguments) {
        functionCallArguments = JSON.parse(functionCall.arguments);
      }
      return await action.handler(functionCallArguments);
    }
  };
}
