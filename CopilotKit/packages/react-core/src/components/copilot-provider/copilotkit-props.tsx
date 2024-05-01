import { ReactNode } from "react";

/**
 * Props for CopilotKit.
 */

export interface CopilotKitProps {
  /**
   * The public API key for Copilot Cloud.
   */
  publicApiKey?: string;

  /**
   * Cloud feature: Restrict to a specific topic.
   */
  cloudRestrictToTopic?: {
    validTopics?: string[];
    invalidTopics?: string[];
  };

  /**
   * the endpoint for the Copilot Runtime instance.
   */
  runtimeUrl?: string;

  /**
   * @deprecated use runtimeUrl instead
   */
  url?: string;

  /**
   * additional headers to be sent with the request
   * @default {}
   * @example
   * ```
   * {
   *   'Authorization': 'Bearer your_token_here'
   * }
   * ```
   */
  headers?: Record<string, string>;

  /**
   * Additional body params to be sent with the request
   * @default {}
   * @example
   * ```
   * {
   *   'message': 'Hello, world!'
   * }
   * ```
   */
  body?: Record<string, any>;

  /**
   * The children to be rendered within the CopilotKit.
   */
  children: ReactNode;

  /**
   * Backend only props that will be combined to body params to be sent with the request
   * @default {}
   * @example
   * ```
   * {
   *   'user_id': 'users_id',
   * }
   * ```
   */
  backendOnlyProps?: Record<string, any>;
}
