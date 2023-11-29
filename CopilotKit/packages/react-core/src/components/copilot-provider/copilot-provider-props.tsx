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

export type CopilotProviderProps =
  | CopilotProviderApiEndpointProps
  | CopilotProviderApiConfigProps;
