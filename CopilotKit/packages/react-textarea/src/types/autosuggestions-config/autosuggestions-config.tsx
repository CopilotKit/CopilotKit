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

export interface AutosuggestionsConfig
  extends Omit<BaseAutosuggestionsConfig, "apiConfig"> {
  externalContextCategories: string[] | undefined;
  apiConfigs: {
    suggestionsApiConfig: SuggestionsApiConfig;
    insertionApiConfig: InsertionsApiConfig;
  };
}

export interface AutosuggestionsConfigPartialOverrides
  extends Omit<AutosuggestionsConfig, "apiConfigs"> {
  apiConfigs: {
    suggestionsApiConfig?: Partial<SuggestionsApiConfig>;
    insertionApiConfig?: Partial<InsertionsApiConfig>;
  };
}

export const defaultAutosuggestionsConfig: Omit<
  AutosuggestionsConfig,
  "textareaPurpose" | "apiEndpoint"
> = {
  ...defaultBaseAutosuggestionsConfig,
  externalContextCategories: undefined,
  apiConfigs: {
    suggestionsApiConfig: defaultSuggestionsApiConfig,
    insertionApiConfig: defaultInsertionsApiConfig,
  },
};
