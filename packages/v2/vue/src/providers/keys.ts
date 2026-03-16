import type { ComputedRef, InjectionKey, Ref, ShallowRef } from "vue";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import type { CopilotChatConfigurationValue } from "./types";

export interface CopilotKitContextValue {
  copilotkit: ShallowRef<CopilotKitCoreVue>;
  executingToolCallIds: Ref<ReadonlySet<string>>;
}

export const CopilotKitKey: InjectionKey<CopilotKitContextValue> =
  Symbol("CopilotKit");

export const CopilotChatConfigurationKey: InjectionKey<
  ComputedRef<CopilotChatConfigurationValue>
> = Symbol("CopilotChatConfiguration");
