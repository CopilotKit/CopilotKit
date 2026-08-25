import type { ComputedRef, InjectionKey, Ref, ShallowRef } from "vue";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import type { CopilotChatConfigurationValue } from "./types";
import type { A2UITheme } from "../types";
import type { SandboxFunction } from "../types";

export interface CopilotKitContextValue {
  copilotkit: ShallowRef<CopilotKitCoreVue>;
  executingToolCallIds: Ref<ReadonlySet<string>>;
  a2uiTheme: ComputedRef<A2UITheme | undefined>;
  a2uiCatalog: ComputedRef<unknown>;
  a2uiLoadingComponent: ComputedRef<unknown>;
  a2uiIncludeSchema: ComputedRef<boolean>;
}

export const CopilotKitKey: InjectionKey<CopilotKitContextValue> =
  Symbol("CopilotKit");

export const CopilotChatConfigurationKey: InjectionKey<
  ComputedRef<CopilotChatConfigurationValue>
> = Symbol("CopilotChatConfiguration");

export const SandboxFunctionsKey: InjectionKey<
  Ref<readonly SandboxFunction[]>
> = Symbol("SandboxFunctions");

export type VueInspectorOpenRequest = {
  messageId: string;
  threadId?: string;
  agentId?: string;
  menu?: "event-snippets";
  snippetId?: string;
};

export type VueInspectorSaveRequest = {
  threadId?: string;
  agentId?: string;
} & (
  | {
      kind: "text";
      messageId: string;
      content: string;
    }
  | {
      kind: "reasoning";
      messageId: string;
      content: string;
    }
  | {
      kind: "tool-call";
      messageId: string;
      toolCallId: string;
      toolName: string;
      argsJson: string | Record<string, unknown>;
    }
  | {
      kind: "activity";
      messageId: string;
      activityType: string;
      content: unknown;
    }
);

export type VueInspectorContextValue = {
  isInspectorEnabled: ComputedRef<boolean>;
  openInspector: (request: VueInspectorOpenRequest) => void;
  saveEventSnippet: (request: VueInspectorSaveRequest) => Promise<void>;
};

export const InspectorKey: InjectionKey<VueInspectorContextValue> = Symbol(
  "CopilotKitInspector",
);
