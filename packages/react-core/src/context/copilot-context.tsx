"use client";

import { FunctionCallHandler } from "ai";
import { ChatCompletionFunctions } from "openai-edge/types/api";
import React from "react";
import { TreeNodeId } from "../hooks/use-tree";
import { AnnotatedFunction } from "../types/annotated-function";

export interface CopilotContextParams {
  // function-calling
  entryPoints: Record<string, AnnotatedFunction<any[]>>;
  setEntryPoint: (id: string, entryPoint: AnnotatedFunction<any[]>) => void;
  removeEntryPoint: (id: string) => void;
  getChatCompletionFunctionDescriptions: () => ChatCompletionFunctions[];
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
  getChatCompletionFunctionDescriptions: () => [],
  getFunctionCallHandler: () => async () => {},

  getContextString: () => "",
  addContext: () => "",
  removeContext: () => {},
};

export const CopilotContext =
  React.createContext<CopilotContextParams>(emptyCopilotContext);
