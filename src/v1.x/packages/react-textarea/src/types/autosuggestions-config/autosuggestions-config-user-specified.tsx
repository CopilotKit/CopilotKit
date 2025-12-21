import { AutosuggestionsConfig } from ".";
import { InsertionsApiConfig } from "./insertions-api-config";
import { SuggestionsApiConfig } from "./suggestions-api-config";

// Mostly mirrors a partial SuggestionsApiConfig, but with some fields MANDATORY.
export interface SuggestionsApiConfigUserSpecified extends Partial<SuggestionsApiConfig> {}

// Mostly mirrors a partial InsertionsApiConfig, but with some fields MANDATORY.
export interface InsertionsApiConfigUserSpecified extends Partial<InsertionsApiConfig> {}

// Mostly mirrors a partial AutosuggestionsConfig, but with some fields MANDATORY.
export interface AutosuggestionsConfigUserSpecified
  extends Partial<Omit<AutosuggestionsConfig, "chatApiConfigs" | "textareaPurpose">> {
  textareaPurpose: string; // the user MUST specify textareaPurpose - it's not optional
  chatApiConfigs: {
    suggestionsApiConfig?: SuggestionsApiConfigUserSpecified;
    insertionApiConfig?: InsertionsApiConfigUserSpecified;
  };
}
