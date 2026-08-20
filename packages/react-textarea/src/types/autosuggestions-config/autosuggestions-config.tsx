/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-textarea — AutosuggestionsConfig:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-textarea — defaultAutosuggestionsConfig:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-textarea/src/types/autosuggestions-config/autosuggestions-config.tsx
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import {
  BaseAutosuggestionsConfig,
  defaultBaseAutosuggestionsConfig,
} from "../base";
import {
  SuggestionsApiConfig,
  defaultSuggestionsApiConfig,
} from "./suggestions-api-config";
import {
  InsertionsApiConfig,
  defaultInsertionsApiConfig,
} from "./insertions-api-config";
import {
  EditingApiConfig,
  defaultEditingApiConfig,
} from "./editing-api-config";
import { defaultCopilotContextCategories } from "@copilotkit/react-core";

// Like the base autosuggestions config, with 2 additional fields:
// 1. contextCategories: string[] | undefined;
// 2. instead of apiConfigs, we have chatApiConfigs: a higher-level abstraction that uses a ChatGPT-like API endpoint.
export interface AutosuggestionsConfig extends Omit<
  BaseAutosuggestionsConfig,
  "apiConfig"
> {
  contextCategories: string[];
  chatApiConfigs: {
    suggestionsApiConfig: SuggestionsApiConfig;
    insertionApiConfig: InsertionsApiConfig;
    editingApiConfig: EditingApiConfig;
  };
}

export const defaultAutosuggestionsConfig: Omit<
  AutosuggestionsConfig,
  "textareaPurpose" | "apiEndpoint"
> = {
  ...defaultBaseAutosuggestionsConfig,
  contextCategories: defaultCopilotContextCategories,
  chatApiConfigs: {
    suggestionsApiConfig: defaultSuggestionsApiConfig,
    insertionApiConfig: defaultInsertionsApiConfig,
    editingApiConfig: defaultEditingApiConfig,
  },
};
