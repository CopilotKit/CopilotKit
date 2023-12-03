"use client";
import { ReactNode } from "react";
import { CopilotApiConfig } from "../../context/copilot-context";

/**
 * Props for the CopilotProvider when using a chat API endpoint.
 */

export interface CopilotProviderApiEndpointProps {
  /**
   * The endpoint for the chat API.
   */
  chatApiEndpoint: string;

  /**
   * The endpoint for the chat API v2.
   * If not provided, defaults to chatApiEndpoint + "/v2".
   * This is used for the chat API v2.
   * If you are not using the chat API v2, you can ignore this.
   * @default chatApiEndpoint + "/v2"
   * @optional
   */
  chatApiEndpointV2?: string;

  /**
   * The children to be rendered within the CopilotProvider.
   */
  children: ReactNode;
}
/**
 * Props for the CopilotProvider when using a CopilotApiConfig.
 */

export interface CopilotProviderApiConfigProps {
  /**
   * The configuration for the Copilot API.
   */
  chatApiConfig: CopilotApiConfig;

  /**
   * The children to be rendered within the CopilotProvider.
   */
  children: ReactNode;
}
/**
 * Props for the CopilotProvider component.
 * Can be either CopilotProviderApiEndpointProps or CopilotProviderApiConfigProps.
 */

export type CopilotProviderProps = CopilotProviderApiEndpointProps | CopilotProviderApiConfigProps;
