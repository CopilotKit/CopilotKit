/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/vue — CopilotKitProps:
 *   V2 import and usage:
 *     import type { CopilotKitProviderProps } from "@copilotkit/vue/v2";
 *     type V2CopilotKitProviderProps = CopilotKitProviderProps;
 *   V2 replacement source: packages/vue/src/v2/providers/CopilotKitProvider.types.ts
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/vue/src/components/copilot-provider/types.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { CopilotKitProviderProps } from "../../v2/providers/CopilotKitProvider.types";

/**
 * V1 CopilotKit component props.
 *
 * Extends the v2 CopilotKitProviderProps with legacy v1-specific fields.
 */
export interface CopilotKitProps extends CopilotKitProviderProps {
  /**
   * Your CopilotKit public license key.
   * @deprecated Use publicLicenseKey with the v2 CopilotKitProvider instead.
   */
  publicApiKey?: string;

  /**
   * Your public license key for accessing Enterprise Intelligence Platform features.
   */
  publicLicenseKey?: string;

  /**
   * The endpoint for the Copilot Runtime instance.
   */
  runtimeUrl?: string;
}
