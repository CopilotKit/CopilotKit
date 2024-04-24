import {
  CopilotCloudConfig,
  FunctionCallHandler,
  Message,
  ToolDefinition,
} from "@copilotkit/shared";
import { ActionRenderProps, FrontendAction } from "../types/frontend-action";
import React, { Ref } from "react";
import { TreeNodeId } from "../hooks/use-tree";
import { DocumentPointer } from "../types";

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
}

export type InChatRenderFunction = (props: ActionRenderProps<any>) => string | JSX.Element;

export interface CopilotContextParams {
  // function-calling
  entryPoints: Record<string, FrontendAction<any>>;
  setEntryPoint: (id: string, entryPoint: FrontendAction<any>) => void;
  removeEntryPoint: (id: string) => void;
  chatComponentsCache: React.RefObject<Record<string, InChatRenderFunction | string>>;
  getChatCompletionFunctionDescriptions: (
    customEntryPoints?: Record<string, FrontendAction<any>>,
  ) => ToolDefinition[];
  getFunctionCallHandler: (
    customEntryPoints?: Record<string, FrontendAction<any>>,
  ) => FunctionCallHandler;

  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;

  // text context
  addContext: (context: string, parentId?: string, categories?: string[]) => TreeNodeId;
  removeContext: (id: TreeNodeId) => void;
  getContextString: (documents: DocumentPointer[], categories: string[]) => string;

  // document context
  addDocumentContext: (documentPointer: DocumentPointer, categories?: string[]) => TreeNodeId;
  removeDocumentContext: (documentId: string) => void;
  getDocumentsContext: (categories: string[]) => DocumentPointer[];

  // api endpoints
  copilotApiConfig: CopilotApiConfig;
}

const emptyCopilotContext: CopilotContextParams = {
  entryPoints: {},
  setEntryPoint: () => {},
  removeEntryPoint: () => {},
  getChatCompletionFunctionDescriptions: () => returnAndThrowInDebug([]),
  getFunctionCallHandler: () => returnAndThrowInDebug(async () => {}),
  chatComponentsCache: { current: {} },
  getContextString: (documents: DocumentPointer[], categories: string[]) =>
    returnAndThrowInDebug(""),
  addContext: () => "",
  removeContext: () => {},
  messages: [],
  setMessages: () => returnAndThrowInDebug([]),

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
};

export const CopilotContext = React.createContext<CopilotContextParams>(emptyCopilotContext);

export function useCopilotContext(): CopilotContextParams {
  return React.useContext(CopilotContext);
}

function returnAndThrowInDebug<T>(value: T): T {
  throw new Error("Remember to wrap your app in a `<CopilotKit> {...} </CopilotKit>` !!!");
  return value;
}
