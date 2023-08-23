"use client";

import { FunctionCallHandler } from "ai";
import { CompletionCreateParams } from "openai/resources/chat";
import React from "react";
import { TreeNodeId } from "../hooks/use-tree";
import { AnnotatedFunction } from "../types/annotated-function";

export interface CopilotContextParams {
  // function-calling
  entryPoints: Record<string, AnnotatedFunction<any[]>>;
  setEntryPoint: (id: string, entryPoint: AnnotatedFunction<any[]>) => void;
  removeEntryPoint: (id: string) => void;
  getChatCompletionFunctionDescriptions: () => CompletionCreateParams.Function[];
  getFunctionCallHandler: () => FunctionCallHandler;

  // text context
  getContextString: (categories?: string[]) => string;
  addContext: (
    context: string,
    parentId?: string,
    categories?: string[]
  ) => TreeNodeId;
  removeContext: (id: TreeNodeId) => void;
}

const emptyCopilotContext: CopilotContextParams = {
  entryPoints: {},
  setEntryPoint: () => {},
  removeEntryPoint: () => {},
  getChatCompletionFunctionDescriptions: () => returnAndThrowInDebug([]),
  getFunctionCallHandler: () => returnAndThrowInDebug(async () => {}),

  getContextString: () => returnAndThrowInDebug(""),
  addContext: () => "",
  removeContext: () => {},
};

export const CopilotContext =
  React.createContext<CopilotContextParams>(emptyCopilotContext);

function returnAndThrowInDebug<T>(value: T): T {
  throw new Error(
    "Remember to wrap your app in a `<CopilotProvider> {...} </CopilotProvider>` !!!"
  );
  return value;
}
