/**
 * This component will typically wrap your entire application (or a sub-tree of your application where you want to have a copilot). It provides the copilot context to all other components and hooks.
 *
 * ## Example
 *
 * <Tabs items={["Copilot Cloud (Recommended)", "Self-hosted Runtime"]}>
 *   <Tabs.Tab>
 *
 *     You can get your Copilot Cloud API key for free by <LinkToCopilotCloud>signing up here</LinkToCopilotCloud>.
 *
 *     ```tsx
 *     import { CopilotKit } from "@copilotkit/react-core";
 *
 *     <CopilotKit publicApiKey="<your-public-api-key>">
 *       // ... your app ...
 *     </CopilotKit>
 *     ```
 *   </Tabs.Tab>
 *
 *   <Tabs.Tab>
 *     You can find more information about self-hosting CopilotKit [here](/concepts/copilot-runtime).
 *
 *     ```tsx
 *     import { CopilotKit } from "@copilotkit/react-core";
 *
 *     <CopilotKit runtimeUrl="<your-runtime-url>">
 *       // ... your app ...
 *     </CopilotKit>
 *     ```
 *   </Tabs.Tab>
 * </Tabs>
 */
import { useCallback, useRef, useState } from "react";
import {
  CopilotContext,
  CopilotApiConfig,
  InChatRenderFunction,
} from "../../context/copilot-context";
import useTree from "../../hooks/use-tree";
import { CopilotChatSuggestionConfiguration, DocumentPointer } from "../../types";
import { flushSync } from "react-dom";
import {
  COPILOT_CLOUD_CHAT_URL,
  CopilotCloudConfig,
  FunctionCallHandler,
} from "@copilotkit/shared";
import { AgentStateMessage, Message } from "@copilotkit/runtime-client-gql";

import { FrontendAction } from "../../types/frontend-action";
import useFlatCategoryStore from "../../hooks/use-flat-category-store";
import { CopilotKitProps } from "./copilotkit-props";

export function CopilotKit({ children, ...props }: CopilotKitProps) {
  // Compute all the functions and properties that we need to pass
  // to the CopilotContext.

  if (!props.runtimeUrl && !props.publicApiKey) {
    throw new Error(
      "Please provide either a runtimeUrl or a publicApiKey to the CopilotKit component.",
    );
  }

  const chatApiEndpoint = props.runtimeUrl || COPILOT_CLOUD_CHAT_URL;

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
    headers: props.headers || {},
    properties: props.properties || {},
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

  const [agentStates, setAgentStates] = useState<Record<string, AgentStateMessage | null>>({});

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
        showDevConsole: props.showDevConsole === undefined ? "auto" : props.showDevConsole,
        agentStates,
        setAgentStates,
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
    let result: any = undefined;
    if (action) {
      await new Promise<void>((resolve, reject) => {
        flushSync(async () => {
          try {
            result = await action.handler(args);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return result;
  };
}
