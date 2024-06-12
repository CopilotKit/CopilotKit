/**
 * Provides the Copilot context to its children.
 * 
 * <img
 *   referrerPolicy="no-referrer-when-downgrade"
 *   src="https://static.scarf.sh/a.png?x-pxid=a9b290bb-38f9-4518-ac3b-8f54fdbf43be"
 * />
 * 
 * This component provides the Copilot context to its children.
 * It can be configured either with a chat API endpoint or a `CopilotApiConfig`.
 * 
 * <Note>
 *   The backend can use OpenAI, or you can bring your own LLM. For examples of the
 *   backend api implementation, see `examples/next-openai` or the [runtime
 *   docs](https://docs.copilotkit.ai/getting-started/quickstart-runtime).
 * </Note>
 * 
 * <RequestExample>
 *   ```jsx CopilotKit Example
 *   import { CopilotKit } from "@copilotkit/react-core";
 * 
 *   <CopilotKit 
 *     runtimeUrl="https://your.copilotkit.api">
 *     <YourApp/>
 *   </CopilotKit>
 *   ```
 * </RequestExample>
 * 
 * ## Example usage
 * 
 * ```jsx
 * <CopilotKit publicApiKey="the api key or self host (see below)">
 *   <App />
 * </CopilotKit>
```
 */
import { Ref, useCallback, useRef, useState } from "react";
import {
  CopilotContext,
  CopilotApiConfig,
  InChatRenderFunction,
} from "../../context/copilot-context";
import useTree from "../../hooks/use-tree";
import { CopilotChatSuggestionConfiguration, DocumentPointer } from "../../types";

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

export function CopilotKit({ children, ...props }: CopilotKitProps) {
  // Compute all the functions and properties that we need to pass
  // to the CopilotContext.

  if (!props.runtimeUrl && !props.url && !props.publicApiKey) {
    throw new Error("Please provide either a url or a publicApiKey to the CopilotKit component.");
  }

  const chatApiEndpoint = props.runtimeUrl || props.url || COPILOT_CLOUD_CHAT_URL;

  const [actions, setActions] = useState<Record<string, FrontendAction<any>>>({});
  const chatComponentsCache = useRef<Record<string, InChatRenderFunction | string>>({});
  const { addElement, removeElement, printTree } = useTree();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatInstructions, setChatInstructions] = useState("");

  const {
    addElement: addDocument,
    removeElement: removeDocument,
    allElements: allDocuments,
  } = useFlatCategoryStore<DocumentPointer>();

  const setAction = useCallback((id: string, action: FrontendAction<any>) => {
    setActions((prevPoints) => {
      return {
        ...prevPoints,
        [id]: action,
      };
    });
  }, []);

  const removeAction = useCallback((id: string) => {
    setActions((prevPoints) => {
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

  const getFunctionCallHandler = useCallback(
    (customEntryPoints?: Record<string, FrontendAction<any>>) => {
      return entryPointsToFunctionCallHandler(Object.values(customEntryPoints || actions));
    },
    [actions],
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
    transcribeAudioUrl: props.transcribeAudioUrl,
    textToSpeechUrl: props.textToSpeechUrl,
    credentials: props.credentials,
  };

  const [chatSuggestionConfiguration, setChatSuggestionConfiguration] = useState<{
    [key: string]: CopilotChatSuggestionConfiguration;
  }>({});

  const addChatSuggestionConfiguration = (
    id: string,
    suggestion: CopilotChatSuggestionConfiguration,
  ) => {
    setChatSuggestionConfiguration((prev) => ({ ...prev, [id]: suggestion }));
  };

  const removeChatSuggestionConfiguration = (id: string) => {
    setChatSuggestionConfiguration((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  return (
    <CopilotContext.Provider
      value={{
        actions,
        chatComponentsCache,
        getFunctionCallHandler,
        setAction,
        removeAction,
        getContextString,
        addContext,
        removeContext,
        getDocumentsContext,
        addDocumentContext,
        removeDocumentContext,
        copilotApiConfig: copilotApiConfig,
        messages,
        setMessages,
        isLoading,
        setIsLoading,
        chatSuggestionConfiguration,
        addChatSuggestionConfiguration,
        removeChatSuggestionConfiguration,
        chatInstructions,
        setChatInstructions,
      }}
    >
      {children}
    </CopilotContext.Provider>
  );
}

export const defaultCopilotContextCategories = ["global"];

function entryPointsToFunctionCallHandler(actions: FrontendAction<any>[]): FunctionCallHandler {
  return async ({ messages, name, args }) => {
    let actionsByFunctionName: Record<string, FrontendAction<any>> = {};
    for (let action of actions) {
      actionsByFunctionName[action.name] = action;
    }

    const action = actionsByFunctionName[name];
    if (action) {
      return await action.handler(args);
    }
  };
}
