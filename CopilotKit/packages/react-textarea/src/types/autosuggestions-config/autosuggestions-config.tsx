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
  apiEndpoint: ChatlikeApiEndpoint;
  apiConfigs: ApiConfigs;
}

export interface ApiConfigs {
  suggestionsApiConfig: SuggestionsApiConfig;
  insertionApiConfig: InsertionsApiConfig;
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
