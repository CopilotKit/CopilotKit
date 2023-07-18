"use client";

import React from "react";
import { AnnotatedFunction } from "../types/annotated-function";
import { TreeNodeId } from "../hooks/use-tree";
import { ChatCompletionFunctions } from "openai-edge/types/api";
import { FunctionCallHandler } from "ai";

export interface CopilotContextParams {
  entryPoints: Record<string, AnnotatedFunction<any[]>>;
  getChatCompletionFunctionDescriptions: () => ChatCompletionFunctions[];
  getFunctionCallHandler: () => FunctionCallHandler;
  setEntryPoint: (id: string, entryPoint: AnnotatedFunction<any[]>) => void;
  removeEntryPoint: (id: string) => void;

  getContextString: () => string;
  addContext: (context: string, parentId?: string) => TreeNodeId;
  removeContext: (id: TreeNodeId) => void;
}

const emptyCopilotContext: CopilotContextParams = {
  entryPoints: {},
  getChatCompletionFunctionDescriptions: () => [],
  getFunctionCallHandler: () => async () => {},
  setEntryPoint: () => {},
  removeEntryPoint: () => {},
  getContextString: () => "",
  addContext: () => "",
  removeContext: () => {},
};

export const CopilotContext =
  React.createContext<CopilotContextParams>(emptyCopilotContext);
