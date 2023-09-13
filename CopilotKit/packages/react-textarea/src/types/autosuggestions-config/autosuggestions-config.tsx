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
import { ChatlikeApiEndpoint } from ".";

// Like the base autosuggestions config, with 2 additional fields:
// 1. externalContextCategories: string[] | undefined;
// 2. instead of apiConfigs, we have chatApiConfigs: a higher-level abstraction that uses a ChatGPT-like API endpoint.
export interface AutosuggestionsConfig
  extends Omit<BaseAutosuggestionsConfig, "apiConfig"> {
  externalContextCategories: string[] | undefined;
  chatApiConfigs: {
    suggestionsApiConfig: SuggestionsApiConfig;
    insertionApiConfig: InsertionsApiConfig;
  };
}

export const defaultAutosuggestionsConfig: Omit<
  AutosuggestionsConfig,
  "textareaPurpose" | "apiEndpoint"
> = {
  ...defaultBaseAutosuggestionsConfig,
  externalContextCategories: undefined,
  chatApiConfigs: {
    suggestionsApiConfig: defaultSuggestionsApiConfig,
    insertionApiConfig: defaultInsertionsApiConfig,
  },
};
