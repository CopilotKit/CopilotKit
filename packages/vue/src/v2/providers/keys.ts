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
