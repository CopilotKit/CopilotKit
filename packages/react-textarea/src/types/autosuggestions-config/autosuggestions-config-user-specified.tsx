/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-textarea — AutosuggestionsConfigUserSpecified:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-textarea — InsertionsApiConfigUserSpecified:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-textarea — SuggestionsApiConfigUserSpecified:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-textarea/src/types/autosuggestions-config/autosuggestions-config-user-specified.tsx
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { AutosuggestionsConfig } from ".";
import type { InsertionsApiConfig } from "./insertions-api-config";
import type { SuggestionsApiConfig } from "./suggestions-api-config";

// Mostly mirrors a partial SuggestionsApiConfig, but with some fields MANDATORY.
export interface SuggestionsApiConfigUserSpecified extends Partial<SuggestionsApiConfig> {}

// Mostly mirrors a partial InsertionsApiConfig, but with some fields MANDATORY.
export interface InsertionsApiConfigUserSpecified extends Partial<InsertionsApiConfig> {}

// Mostly mirrors a partial AutosuggestionsConfig, but with some fields MANDATORY.
export interface AutosuggestionsConfigUserSpecified extends Partial<
  Omit<AutosuggestionsConfig, "chatApiConfigs" | "textareaPurpose">
> {
  textareaPurpose: string; // the user MUST specify textareaPurpose - it's not optional
  chatApiConfigs: {
    suggestionsApiConfig?: SuggestionsApiConfigUserSpecified;
    insertionApiConfig?: InsertionsApiConfigUserSpecified;
  };
}
