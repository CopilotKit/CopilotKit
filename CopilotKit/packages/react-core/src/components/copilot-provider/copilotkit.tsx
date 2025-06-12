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

import { useCallback, useEffect, useMemo, useRef, useState, SetStateAction } from "react";
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
  randomUUID,
  ConfigurationError,
  MissingPublicApiKeyError,
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
import { Agent, ExtensionsInput } from "@copilotkit/runtime-client-gql";
import {
  LangGraphInterruptAction,
  LangGraphInterruptActionSetterArgs,
} from "../../types/interrupt-action";
import {
  CopilotClientError,
  categorizeCopilotError,
  ErrorHandlerResult,
} from "../../types/error-handler";

export function CopilotKit({ children, ...props }: CopilotKitProps) {
  const showDevConsole = props.showDevConsole === undefined ? "auto" : props.showDevConsole;
  const enabled = shouldShowDevConsole(showDevConsole);

  return (
    <ToastProvider enabled={enabled}>
      <CopilotErrorBoundary publicApiKey={props.publicApiKey} showUsageBanner={enabled}>
        <CopilotKitInternal {...props}>{children}</CopilotKitInternal>
      </CopilotErrorBoundary>
    </ToastProvider>
  );
}

export function CopilotKitInternal(cpkProps: CopilotKitProps) {
  const { children, ...props } = cpkProps;

  /**
   * This will throw an error if the props are invalid.
   */
  validateProps(cpkProps);

  const chatApiEndpoint = props.runtimeUrl || COPILOT_CLOUD_CHAT_URL;

  const [actions, setActions] = useState<Record<string, FrontendAction<any>>>({});
  const [coAgentStateRenders, setCoAgentStateRenders] = useState<
    Record<string, CoAgentStateRender<any>>
  >({});

  const chatComponentsCache = useRef<ChatComponentsCache>({
    actions: {},
    coAgentStateRenders: {},
  });

  const { addElement, removeElement, printTree, getAllElements } = useTree();
  const [isLoading, setIsLoading] = useState(false);
  const [chatInstructions, setChatInstructions] = useState("");
  const [authStates, setAuthStates] = useState<Record<string, AuthState>>({});
  const [extensions, setExtensions] = useState<ExtensionsInput>({});
  const [additionalInstructions, setAdditionalInstructions] = useState<string[]>([]);

  const {
    addElement: addDocument,
    removeElement: removeDocument,
    allElements: allDocuments,
  } = useFlatCategoryStore<DocumentPointer>();

  // Compute all the functions and properties that we need to pass

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

  const getAllContext = useCallback(() => {
    return getAllElements();
  }, [getAllElements]);

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

  // get the appropriate CopilotApiConfig from the props
  const copilotApiConfig: CopilotApiConfig = useMemo(() => {
    let cloud: CopilotCloudConfig | undefined = undefined;
    if (props.publicApiKey) {
      cloud = {
        guardrails: {
          input: {
            restrictToTopic: {
              enabled: Boolean(props.guardrails_c),
              validTopics: props.guardrails_c?.validTopics || [],
              invalidTopics: props.guardrails_c?.invalidTopics || [],
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
    props.guardrails_c,
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

  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
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
  const hasLoadedAgents = useRef(false);

  useEffect(() => {
    if (hasLoadedAgents.current) return;

    const fetchData = async () => {
      const result = await runtimeClient.availableAgents();
      if (result.data?.availableAgents) {
        setAvailableAgents(result.data.availableAgents.agents);
      }
      hasLoadedAgents.current = true;
    };
    void fetchData();
  }, []);

  let initialAgentSession: AgentSession | null = null;
  if (props.agent) {
    initialAgentSession = {
      agentName: props.agent,
    };
  }

  const [agentSession, setAgentSession] = useState<AgentSession | null>(initialAgentSession);

  // Update agentSession when props.agent changes
  useEffect(() => {
    if (props.agent) {
      setAgentSession({
        agentName: props.agent,
      });
    } else {
      setAgentSession(null);
    }
  }, [props.agent]);

  const [internalThreadId, setInternalThreadId] = useState<string>(props.threadId || randomUUID());
  const setThreadId = useCallback(
    (value: SetStateAction<string>) => {
      if (props.threadId) {
        throw new Error("Cannot call setThreadId() when threadId is provided via props.");
      }
      setInternalThreadId(value);
    },
    [props.threadId],
  );

  // update the internal threadId if the props.threadId changes
  useEffect(() => {
    if (props.threadId !== undefined) {
      setInternalThreadId(props.threadId);
    }
  }, [props.threadId]);

  const [runId, setRunId] = useState<string | null>(null);

  const chatAbortControllerRef = useRef<AbortController | null>(null);

  const showDevConsole = props.showDevConsole === undefined ? "auto" : props.showDevConsole;

  const [langGraphInterruptAction, _setLangGraphInterruptAction] =
    useState<LangGraphInterruptAction | null>(null);
  const setLangGraphInterruptAction = useCallback((action: LangGraphInterruptActionSetterArgs) => {
    _setLangGraphInterruptAction((prev) => {
      if (prev == null) return action as LangGraphInterruptAction;
      if (action == null) return null;
      let event = prev.event;
      if (action.event) {
        // @ts-ignore
        event = { ...prev.event, ...action.event };
      }
      return { ...prev, ...action, event };
    });
  }, []);
  const removeLangGraphInterruptAction = useCallback((): void => {
    setLangGraphInterruptAction(null);
  }, []);

  // Error handling implementation
  const handleError = useCallback(
    async (
      error: unknown,
      context: Partial<{ componentName: string; hookName: string; actionName: string }> = {},
    ): Promise<void> => {
      // First check if this error has embedded categorized error data from the runtime
      let categorizedError: any;

      // Check for GraphQL error with extensions (from runtime)
      if (error && typeof error === "object" && "extensions" in error) {
        const extensions = (error as any).extensions;
        if (extensions?.categorizedError) {
          // Use the runtime's categorized error directly
          categorizedError = extensions.categorizedError;
        }
      }

      // If no embedded categorized error, categorize it client-side
      if (!categorizedError) {
        categorizedError = categorizeCopilotError(error, {
          threadId: internalThreadId,
          runId: runId || undefined,
        });
      }

      // Enrich error with additional context
      if (categorizedError.category === "component") {
        if (context.componentName) categorizedError.componentName = context.componentName;
        if (context.hookName) categorizedError.hookName = context.hookName;
      }

      // Call user's error handler if provided
      if (props.onError) {
        try {
          const result = await props.onError(categorizedError);
          if (result === "handled") {
            // User handled the error, don't proceed with default handling
            return;
          }
        } catch (handlerError) {
          console.error("Error in CopilotKit error handler:", handlerError);
          // Continue with default error handling
        }
      }

      // Default error handling based on category
      switch (categorizedError.category) {
        case "agent":
          console.error(`[CopilotKit Agent Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            agentName: categorizedError.agentName,
            nodeName: categorizedError.nodeName,
            threadId: categorizedError.threadId,
            timestamp: new Date(categorizedError.timestamp).toISOString(),
            guidance: getAgentErrorGuidance(categorizedError),
          });
          break;

        case "network":
          console.error(`[CopilotKit Network Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            endpoint: categorizedError.endpoint,
            statusCode: categorizedError.statusCode,
            threadId: categorizedError.threadId,
          });
          break;

        case "component":
          const isExtractError = categorizedError.componentName === "extract";
          console.error(`[CopilotKit Component Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            componentName: categorizedError.componentName,
            hookName: categorizedError.hookName,
            threadId: categorizedError.threadId,
            timestamp: new Date(categorizedError.timestamp).toISOString(),
            ...(isExtractError && {
              guidance:
                "Extract operation failed. Common causes: 1) LLM API key issues, 2) Network connectivity, 3) Model availability, 4) Rate limiting. Check runtime logs for specific error details.",
              troubleshooting: {
                checkApiKey: "Verify your LLM provider API key is set correctly",
                checkNetwork: "Ensure network connectivity to LLM provider",
                checkQuota: "Verify you haven't exceeded usage quotas",
                checkLogs: "Check server/runtime logs for the underlying error",
              },
            }),
          });
          break;

        case "runtime":
          console.error(`[CopilotKit Runtime Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            threadId: categorizedError.threadId,
          });
          break;

        case "action_execution":
          console.error(`[CopilotKit Action Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            actionName: categorizedError.actionName,
            threadId: categorizedError.threadId,
          });
          break;

        case "llm_provider":
          const providerName = categorizedError.provider
            ? ` (${categorizedError.provider.toUpperCase()})`
            : "";
          const isExtractFailure =
            categorizedError.originalError?.message?.includes("extract() failed");
          const contextInfo = isExtractFailure ? " during extract operation" : "";

          console.error(
            `[CopilotKit LLM Provider Error${providerName}] ${categorizedError.message}${contextInfo}`,
            {
              type: categorizedError.type,
              provider: categorizedError.provider,
              model: categorizedError.model,
              threadId: categorizedError.threadId,
              timestamp: new Date(categorizedError.timestamp).toISOString(),
              retryAfter: categorizedError.retryAfter,
              guidance: getProviderErrorGuidance(categorizedError),
              ...(isExtractFailure && {
                note: "This extract() failure was caused by an LLM provider issue",
                originalError: categorizedError.originalError?.message,
              }),
            },
          );
          break;

        case "security":
          console.error(`[CopilotKit Security Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            threadId: categorizedError.threadId,
          });
          break;

        case "data_processing":
          console.error(`[CopilotKit Data Processing Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            threadId: categorizedError.threadId,
          });
          break;

        case "resource":
          console.error(`[CopilotKit Resource Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            resourceType: categorizedError.resourceType,
            threadId: categorizedError.threadId,
          });
          break;

        case "integration":
          console.error(`[CopilotKit Integration Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            serviceName: categorizedError.serviceName,
            threadId: categorizedError.threadId,
          });
          break;

        case "concurrency":
          console.error(`[CopilotKit Concurrency Error] ${categorizedError.message}`, {
            type: categorizedError.type,
            resourceId: categorizedError.resourceId,
            threadId: categorizedError.threadId,
          });
          break;

        default:
          console.error("[CopilotKit Error]", categorizedError);
      }
    },
    [props.onError, internalThreadId, runId],
  );

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
        getAllContext,
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
        additionalInstructions,
        setAdditionalInstructions,
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
        threadId: internalThreadId,
        setThreadId,
        runId,
        setRunId,
        chatAbortControllerRef,
        availableAgents,
        authConfig_c: props.authConfig_c,
        authStates_c: authStates,
        setAuthStates_c: setAuthStates,
        extensions,
        setExtensions,
        langGraphInterruptAction,
        setLangGraphInterruptAction,
        removeLangGraphInterruptAction,
        onError: props.onError,
        handleError,
      }}
    >
      <CopilotMessages>{children}</CopilotMessages>
    </CopilotContext.Provider>
  );
}

export const defaultCopilotContextCategories = ["global"];

function entryPointsToFunctionCallHandler(actions: FrontendAction<any>[]): FunctionCallHandler {
  return async ({ name, args }) => {
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

function formatFeatureName(featureName: string): string {
  return featureName
    .replace(/_c$/, "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function validateProps(props: CopilotKitProps): never | void {
  const cloudFeatures = Object.keys(props).filter((key) => key.endsWith("_c"));

  if (!props.runtimeUrl && !props.publicApiKey) {
    throw new ConfigurationError("Missing required prop: 'runtimeUrl' or 'publicApiKey'");
  }

  if (cloudFeatures.length > 0 && !props.publicApiKey) {
    throw new MissingPublicApiKeyError(
      `Missing required prop: 'publicApiKey' to use cloud features: ${cloudFeatures
        .map(formatFeatureName)
        .join(", ")}`,
    );
  }
}

// Helper function to provide actionable guidance for LLM provider errors
function getProviderErrorGuidance(error: any): string {
  if (!error || error.category !== "llm_provider") return "";

  switch (error.type) {
    case "auth_failed":
      return "Check your API key configuration in environment variables or provider settings.";
    case "quota_exceeded":
      return "Upgrade your plan, check billing settings, or wait for quota reset.";
    case "rate_limited":
      return error.retryAfter
        ? `Wait ${error.retryAfter} seconds before retrying, or implement exponential backoff.`
        : "Implement rate limiting or wait before retrying.";
    case "model_unavailable":
      return "Verify the model name is correct and available in your region/plan.";
    case "invalid_request":
      return "Check request parameters, message format, and API version compatibility.";
    case "server_error":
      return "This is a provider-side issue. Try again later or check provider status page.";
    default:
      return "Check provider documentation and your configuration settings.";
  }
}

function getAgentErrorGuidance(error: any): string {
  if (!error || error.category !== "agent") return "";

  switch (error.type) {
    case "execution_failed":
      return "Agent execution failed. Check agent configuration, node definitions, and runtime logs.";
    case "not_found":
      return "Agent not found. Verify the agent name and ensure it's properly deployed.";
    case "timeout":
      return "Agent execution timed out. Consider increasing timeout limits or optimizing agent logic.";
    case "invalid_state":
      return "Agent state is invalid. Check state transitions and data validation in your agent.";
    default:
      return "Check agent configuration, logs, and runtime status for more details.";
  }
}
