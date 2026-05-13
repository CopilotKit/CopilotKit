import type { CopilotKitProviderProps } from "../../v2/providers/CopilotKitProvider.types";

/**
 * V1 CopilotKit component props.
 *
 * Extends the v2 CopilotKitProviderProps with legacy v1-specific fields.
 */
export interface CopilotKitProps extends CopilotKitProviderProps {
  /**
   * Your Copilot Cloud API key.
   * @deprecated Use publicLicenseKey with the v2 CopilotKitProvider instead.
   */
  publicApiKey?: string;

  /**
   * Your public license key for accessing premium CopilotKit features.
   */
  publicLicenseKey?: string;

  /**
   * The endpoint for the Copilot Runtime instance.
   */
  runtimeUrl?: string;
}
