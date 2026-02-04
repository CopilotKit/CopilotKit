import type { CopilotContextParams, CopilotApiConfig } from "../context";

const noop = () => {};

const copilotApiConfig: CopilotApiConfig = {
  chatApiEndpoint: "http://localhost",
  headers: {},
};

export function createTestCopilotContext(
  overrides: Partial<CopilotContextParams> = {},
): CopilotContextParams {
  return {
    actions: {},
    setAction: noop,
    removeAction: noop,

    setRegisteredActions: () => "action-id",
    removeRegisteredAction: noop,

    chatComponentsCache: { current: { actions: {}, coAgentStateRenders: {} } },
    getFunctionCallHandler: () => async () => {},

    addContext: () => "context-id",
    removeContext: noop,
    getAllContext: () => [],
    getContextString: () => "",

    addDocumentContext: () => "document-id",
    removeDocumentContext: noop,
    getDocumentsContext: () => [],

    isLoading: false,
    setIsLoading: noop,

    chatSuggestionConfiguration: {},
    addChatSuggestionConfiguration: noop,
    removeChatSuggestionConfiguration: noop,

    chatInstructions: "",
    setChatInstructions: noop,

    additionalInstructions: [],
    setAdditionalInstructions: noop,

    copilotApiConfig,

    showDevConsole: false,

    coagentStates: {},
    setCoagentStates: noop,
    coagentStatesRef: { current: {} },
    setCoagentStatesWithRef: noop,

    agentSession: null,
    setAgentSession: noop,

    agentLock: null,

    threadId: "",
    setThreadId: noop,

    runId: null,
    setRunId: noop,

    chatAbortControllerRef: { current: null },

    forwardedParameters: {},
    availableAgents: [],

    extensions: {},
    setExtensions: noop,

    interruptActions: {},
    setInterruptAction: noop,
    removeInterruptAction: noop,
    interruptEventQueue: {},
    addInterruptEvent: noop,
    resolveInterruptEvent: noop,

    onError: noop,

    bannerError: null,
    setBannerError: noop,
    internalErrorHandlers: {},
    setInternalErrorHandler: noop,
    removeInternalErrorHandler: noop,

    ...overrides,
  };
}
