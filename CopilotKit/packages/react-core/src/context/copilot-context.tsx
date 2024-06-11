import {
  CopilotCloudConfig,
  FunctionCallHandler,
  IMessage,
  ToolDefinition,
} from "@copilotkit/shared";
import { ActionRenderProps, FrontendAction } from "../types/frontend-action";
import React from "react";
import { TreeNodeId } from "../hooks/use-tree";
import { DocumentPointer } from "../types";
import { CopilotChatSuggestionConfiguration } from "../types/chat-suggestion-configuration";

/**
 * Interface for the configuration of the Copilot API.
 */
export interface CopilotApiConfig {
  /**
   * The public API key for Copilot Cloud.
   */
  publicApiKey?: string;

  /**
   * The configuration for Copilot Cloud.
   */
  cloud?: CopilotCloudConfig;

  /**
   * The endpoint for the chat API.
   */
  chatApiEndpoint: string;

  /**
   * The endpoint for the Copilot transcribe audio service.
   */
  transcribeAudioUrl?: string;

  /**
   * The endpoint for the Copilot text to speech service.
   */
  textToSpeechUrl?: string;

  /**
   * The endpoint for the chat API v2.
   */
  chatApiEndpointV2: string;

  /**
   * additional headers to be sent with the request
   * @default {}
   * @example
   * ```
   * {
   *   'Authorization': 'Bearer your_token_here'
   * }
   * ```
   */
  headers: Record<string, string>;

  /**
   * Additional body params to be sent with the request
   * @default {}
   * @example
   * ```
   * {
   *   'message': 'Hello, world!'
   * }
   * ```
   */
  body: Record<string, any>;

  /**
   * Backend only props that will be combined to body params to be sent with the request
   * @default {}
   * @example
   * ```
   * {
   *   'user_id': 'user_id'
   * }
   * ```
   */
  backendOnlyProps?: Record<string, any>;

  /**
   * Indicates whether the user agent should send or receive cookies from the other domain
   * in the case of cross-origin requests.
   */
  credentials?: RequestCredentials;
}

export type InChatRenderFunction = (props: ActionRenderProps<any>) => string | JSX.Element;

export interface CopilotContextParams {
  // function-calling
  actions: Record<string, FrontendAction<any>>;
  setAction: (id: string, action: FrontendAction<any>) => void;
  removeAction: (id: string) => void;
  chatComponentsCache: React.RefObject<Record<string, InChatRenderFunction | string>>;

  getFunctionCallHandler: (
    customEntryPoints?: Record<string, FrontendAction<any>>,
  ) => FunctionCallHandler;

  // text context
  addContext: (context: string, parentId?: string, categories?: string[]) => TreeNodeId;
  removeContext: (id: TreeNodeId) => void;
  getContextString: (documents: DocumentPointer[], categories: string[]) => string;

  // document context
  addDocumentContext: (documentPointer: DocumentPointer, categories?: string[]) => TreeNodeId;
  removeDocumentContext: (documentId: string) => void;
  getDocumentsContext: (categories: string[]) => DocumentPointer[];

  // chat
  messages: IMessage[];
  setMessages: React.Dispatch<React.SetStateAction<IMessage[]>>;

  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;

  chatSuggestionConfiguration: { [key: string]: CopilotChatSuggestionConfiguration };
  addChatSuggestionConfiguration: (
    id: string,
    suggestion: CopilotChatSuggestionConfiguration,
  ) => void;
  removeChatSuggestionConfiguration: (id: string) => void;

  chatInstructions: string;
  setChatInstructions: React.Dispatch<React.SetStateAction<string>>;

  // api endpoints
  copilotApiConfig: CopilotApiConfig;
}

const emptyCopilotContext: CopilotContextParams = {
  actions: {},
  setAction: () => {},
  removeAction: () => {},

  chatComponentsCache: { current: {} },
  getContextString: (documents: DocumentPointer[], categories: string[]) =>
    returnAndThrowInDebug(""),
  addContext: () => "",
  removeContext: () => {},

  getFunctionCallHandler: () => returnAndThrowInDebug(async () => {}),

  messages: [],
  setMessages: () => returnAndThrowInDebug([]),

  isLoading: false,
  setIsLoading: () => returnAndThrowInDebug(false),

  chatInstructions: "",
  setChatInstructions: () => returnAndThrowInDebug(""),

  getDocumentsContext: (categories: string[]) => returnAndThrowInDebug([]),
  addDocumentContext: () => returnAndThrowInDebug(""),
  removeDocumentContext: () => {},

  copilotApiConfig: new (class implements CopilotApiConfig {
    get chatApiEndpoint(): string {
      throw new Error("Remember to wrap your app in a `<CopilotKit> {...} </CopilotKit>` !!!");
    }
    get chatApiEndpointV2(): string {
      throw new Error("Remember to wrap your app in a `<CopilotKit> {...} </CopilotKit>` !!!");
    }
    get headers(): Record<string, string> {
      return {};
    }
    get body(): Record<string, any> {
      return {};
    }
  })(),

  chatSuggestionConfiguration: {},
  addChatSuggestionConfiguration: () => {},
  removeChatSuggestionConfiguration: () => {},
};

export const CopilotContext = React.createContext<CopilotContextParams>(emptyCopilotContext);

export function useCopilotContext(): CopilotContextParams {
  return React.useContext(CopilotContext);
}

function returnAndThrowInDebug<T>(value: T): T {
  throw new Error("Remember to wrap your app in a `<CopilotKit> {...} </CopilotKit>` !!!");
  return value;
}
