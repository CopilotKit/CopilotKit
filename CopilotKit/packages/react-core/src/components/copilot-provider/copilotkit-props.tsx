import { ReactNode } from "react";

/**
 * Props for CopilotKit.
 */

export interface CopilotKitProps {
  /**
   * Your Copilot Cloud API key.
   */
  publicApiKey?: string;

  /**
   * Cloud feature: Restrict input to a specific topic.
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
   * The endpoint for the Copilot transcribe audio service.
   */
  transcribeAudioUrl?: string;

  /**
   * The endpoint for the Copilot text to speech service.
   */
  textToSpeechUrl?: string;

  /**
   * @deprecated use runtimeUrl instead
   */
  url?: string;

  /**
   * Additional headers to be sent with the request.
   *
   * For example:
   * ```js
   * {
   *   'Authorization': 'Bearer your_token_here'
   * }
   * ```
   */
  headers?: Record<string, string>;

  /**
   * Additional body params to be sent with the request
   * For example:
   * ```js
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
   * For example:
   * ```js
   * {
   *   'user_id': 'users_id',
   * }
   * ```
   */
  backendOnlyProps?: Record<string, any>;
}
