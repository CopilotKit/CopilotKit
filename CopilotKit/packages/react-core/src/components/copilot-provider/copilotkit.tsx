/**
 * This component will typically wrap your entire application (or a sub-tree of your application where you want to have a copilot). It provides the copilot context to all other components and hooks.
 *
 * ## Example
 *
 * You can find more information about self-hosting CopilotKit [here](/guides/self-hosting).
 *
 * ```tsx
 * import { CopilotKit } from "@copilotkit/react-core";
 *
 * <CopilotKit runtimeUrl="<your-runtime-url>">
 *   // ... your app ...
 * </CopilotKit>
 * ```
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CopilotContext,
  CopilotApiConfig,
  ChatComponentsCache,
  AgentSession,
  AuthState,
} from "../../context/copilot-context";
import useTree from "../../hooks/use-tree";
import { CopilotChatSuggestionConfiguration, DocumentPointer } from "../../types";
import { flushSync } from "react-dom";
import {
  COPILOT_CLOUD_CHAT_URL,
  CopilotCloudConfig,
  FunctionCallHandler,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
} from "@copilotkit/shared";

import { FrontendAction } from "../../types/frontend-action";
import useFlatCategoryStore from "../../hooks/use-flat-category-store";
import { CopilotKitProps } from "./copilotkit-props";
import { CoAgentStateRender } from "../../types/coagent-action";
import { CoagentState } from "../../types/coagent-state";
import { CopilotMessages } from "./copilot-messages";
import { ToastProvider } from "../toast/toast-provider";
import { useCopilotRuntimeClient } from "../../hooks/use-copilot-runtime-client";
import { shouldShowDevConsole } from "../../utils";
import { CopilotErrorBoundary } from "../error-boundary/error-boundary";

export function CopilotKit({ children, ...props }: CopilotKitProps) {
  const showDevConsole = props.showDevConsole === undefined ? "auto" : props.showDevConsole;
  const enabled = shouldShowDevConsole(showDevConsole);
  return (
    <ToastProvider enabled={enabled}>
      <CopilotErrorBoundary>
        <CopilotKitInternal {...props}>{children}</CopilotKitInternal>
      </CopilotErrorBoundary>
    </ToastProvider>
  );
}

export function CopilotKitInternal({ children, ...props }: CopilotKitProps) {
  // Compute all the functions and properties that we need to pass
  // to the CopilotContext.

  if (!props.runtimeUrl && !props.publicApiKey) {
    throw new Error(
      "Please provide either a runtimeUrl or a publicApiKey to the CopilotKit component.",
    );
  }

  const chatApiEndpoint = props.runtimeUrl || COPILOT_CLOUD_CHAT_URL;

  const [actions, setActions] = useState<Record<string, FrontendAction<any>>>({});
  const [coAgentStateRenders, setCoAgentStateRenders] = useState<
    Record<string, CoAgentStateRender<any>>
  >({});
  const chatComponentsCache = useRef<ChatComponentsCache>({
    actions: {},
    coAgentStateRenders: {},
  });
  const { addElement, removeElement, printTree } = useTree();
  const [isLoading, setIsLoading] = useState(false);
  const [chatInstructions, setChatInstructions] = useState("");
  const [authStates, setAuthStates] = useState<Record<string, AuthState>>({});

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

  const setCoAgentStateRender = useCallback((id: string, stateRender: CoAgentStateRender<any>) => {
    setCoAgentStateRenders((prevPoints) => {
      return {
        ...prevPoints,
        [id]: stateRender,
      };
    });
  }, []);

  const removeCoAgentStateRender = useCallback((id: string) => {
    setCoAgentStateRenders((prevPoints) => {
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

  // get the appropriate CopilotApiConfig from the props
  const copilotApiConfig: CopilotApiConfig = useMemo(() => {
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

    return {
      publicApiKey: props.publicApiKey,
      ...(cloud ? { cloud } : {}),
      chatApiEndpoint: chatApiEndpoint,
      headers: props.headers || {},
      properties: props.properties || {},
      transcribeAudioUrl: props.transcribeAudioUrl,
      textToSpeechUrl: props.textToSpeechUrl,
      credentials: props.credentials,
    };
  }, [
    props.publicApiKey,
    props.headers,
    props.properties,
    props.transcribeAudioUrl,
    props.textToSpeechUrl,
    props.credentials,
    props.cloudRestrictToTopic,
  ]);

  const headers = useMemo(() => {
    const authHeaders = Object.values(authStates || {}).reduce((acc, state) => {
      if (state.status === "authenticated" && state.authHeaders) {
        return {
          ...acc,
          ...Object.entries(state.authHeaders).reduce(
            (headers, [key, value]) => ({
              ...headers,
              [key.startsWith("X-Custom-") ? key : `X-Custom-${key}`]: value,
            }),
            {},
          ),
        };
      }
      return acc;
    }, {});

    return {
      ...(copilotApiConfig.headers || {}),
      ...(copilotApiConfig.publicApiKey
        ? { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: copilotApiConfig.publicApiKey }
        : {}),
      ...authHeaders,
    };
  }, [copilotApiConfig.headers, copilotApiConfig.publicApiKey, authStates]);

  const runtimeClient = useCopilotRuntimeClient({
    url: copilotApiConfig.chatApiEndpoint,
    publicApiKey: copilotApiConfig.publicApiKey,
    headers,
    credentials: copilotApiConfig.credentials,
  });

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

  const [coagentStates, setCoagentStates] = useState<Record<string, CoagentState>>({});
  const coagentStatesRef = useRef<Record<string, CoagentState>>({});
  const setCoagentStatesWithRef = useCallback(
    (
      value:
        | Record<string, CoagentState>
        | ((prev: Record<string, CoagentState>) => Record<string, CoagentState>),
    ) => {
      const newValue = typeof value === "function" ? value(coagentStatesRef.current) : value;
      coagentStatesRef.current = newValue;
      setCoagentStates((prev) => {
        return newValue;
      });
    },
    [],
  );

  let initialAgentSession: AgentSession | null = null;
  if (props.agent) {
    initialAgentSession = {
      agentName: props.agent,
    };
  }

  const [agentSession, setAgentSession] = useState<AgentSession | null>(initialAgentSession);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const chatAbortControllerRef = useRef<AbortController | null>(null);

  const showDevConsole = props.showDevConsole === undefined ? "auto" : props.showDevConsole;

  return (
    <CopilotContext.Provider
      value={{
        actions,
        chatComponentsCache,
        getFunctionCallHandler,
        setAction,
        removeAction,
        coAgentStateRenders,
        setCoAgentStateRender,
        removeCoAgentStateRender,
        getContextString,
        addContext,
        removeContext,
        getDocumentsContext,
        addDocumentContext,
        removeDocumentContext,
        copilotApiConfig: copilotApiConfig,
        isLoading,
        setIsLoading,
        chatSuggestionConfiguration,
        addChatSuggestionConfiguration,
        removeChatSuggestionConfiguration,
        chatInstructions,
        setChatInstructions,
        showDevConsole,
        coagentStates,
        setCoagentStates,
        coagentStatesRef,
        setCoagentStatesWithRef,
        agentSession,
        setAgentSession,
        runtimeClient,
        forwardedParameters: props.forwardedParameters || {},
        agentLock: props.agent || null,
        threadId,
        setThreadId,
        runId,
        setRunId,
        chatAbortControllerRef,
        authConfig: props.authConfig,
        authStates,
        setAuthStates,
      }}
    >
      <CopilotMessages>{children}</CopilotMessages>
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
            result = await action.handler?.(args);
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
