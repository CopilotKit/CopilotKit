"use client";

import { FunctionCallHandler } from "ai";
import React from "react";
import { TreeNodeId } from "../hooks/use-tree";
import { AnnotatedFunction } from "../types/annotated-function";
import { ChatCompletionCreateParams } from "openai/resources/chat";
import { DocumentPointer } from "../types";

/**
 * Interface for the configuration of the Copilot API.
 */
export interface CopilotApiConfig {
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
}

export function copilotApiConfigExtrapolator(config: CopilotApiConfig) {
  return {
    get chatApiEndpoint(): string {
      return `${config.chatApiEndpoint}`;
    },
    get chatApiEndpointV2(): string {
      return `${config.chatApiEndpointV2}`;
    },
  };
}

export interface CopilotContextParams {
  // function-calling
  entryPoints: Record<string, AnnotatedFunction<any[]>>;
  setEntryPoint: (id: string, entryPoint: AnnotatedFunction<any[]>) => void;
  removeEntryPoint: (id: string) => void;
  getChatCompletionFunctionDescriptions: () => ChatCompletionCreateParams.Function[];
  getFunctionCallHandler: () => FunctionCallHandler;

  // text context
  getContextString: (documents: DocumentPointer[], categories: string[]) => string;
  addContext: (context: string, parentId?: string, categories?: string[]) => TreeNodeId;
  removeContext: (id: TreeNodeId) => void;

  // document context
  getDocumentsContext: (categories: string[]) => DocumentPointer[];
  addDocumentContext: (documentPointer: DocumentPointer, categories?: string[]) => TreeNodeId;
  removeDocumentContext: (documentId: string) => void;

  // api endpoints
  copilotApiConfig: CopilotApiConfig;
}

const emptyCopilotContext: CopilotContextParams = {
  entryPoints: {},
  setEntryPoint: () => {},
  removeEntryPoint: () => {},
  getChatCompletionFunctionDescriptions: () => returnAndThrowInDebug([]),
  getFunctionCallHandler: () => returnAndThrowInDebug(async () => {}),

  getContextString: (documents: DocumentPointer[], categories: string[]) =>
    returnAndThrowInDebug(""),
  addContext: () => "",
  removeContext: () => {},

  getDocumentsContext: (categories: string[]) => returnAndThrowInDebug([]),
  addDocumentContext: () => returnAndThrowInDebug(""),
  removeDocumentContext: () => {},

  copilotApiConfig: new (class implements CopilotApiConfig {
    get chatApiEndpoint(): string {
      throw new Error(
        "Remember to wrap your app in a `<CopilotProvider> {...} </CopilotProvider>` !!!",
      );
    }
    get chatApiEndpointV2(): string {
      throw new Error(
        "Remember to wrap your app in a `<CopilotProvider> {...} </CopilotProvider>` !!!",
      );
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

function returnAndThrowInDebug<T>(value: T): T {
  throw new Error(
    "Remember to wrap your app in a `<CopilotProvider> {...} </CopilotProvider>` !!!",
  );
  return value;
}
