import { ReactNode } from "react";

/**
 * Props for CopilotKit.
 */

export interface CopilotKitProps {
  /**
   * The api key for Copilot Cloud.
   */
  apiKey?: string;

  /**
   * Cloud feature: Restrict to a specific topic.
   */
  cloudRestrictToTopic?: {
    enabled?: boolean;
    validTopics: string[];
    invalidTopics?: string[];
  };

  /**
   * The endpoint for the chat API.
   */
  url: string;

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
