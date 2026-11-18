import type { InjectionKey } from "vue";
import type { ɵChatConfigurationStore } from "@copilotkit/core";

/**
 * The nearest `CopilotChatConfigurationProvider`'s core store, so a nested
 * provider can link its own store to it.
 */
export const ChatConfigurationStoreKey: InjectionKey<ɵChatConfigurationStore> =
  Symbol("CopilotChatConfigurationStore");
