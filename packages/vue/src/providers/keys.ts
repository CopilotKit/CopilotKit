import type { ComputedRef, InjectionKey, Ref, ShallowRef } from "vue";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import type { CopilotChatConfigurationValue } from "./types";
import type { A2UITheme } from "../types";

export interface CopilotKitContextValue {
  copilotkit: ShallowRef<CopilotKitCoreVue>;
  executingToolCallIds: Ref<ReadonlySet<string>>;
  a2uiTheme: ComputedRef<A2UITheme | undefined>;
}

export const CopilotKitKey: InjectionKey<CopilotKitContextValue> =
  Symbol("CopilotKit");

export const CopilotChatConfigurationKey: InjectionKey<
  ComputedRef<CopilotChatConfigurationValue>
> = Symbol("CopilotChatConfiguration");
