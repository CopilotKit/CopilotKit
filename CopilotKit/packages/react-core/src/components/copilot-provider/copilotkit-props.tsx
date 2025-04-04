import { ForwardedParametersInput } from "@copilotkit/runtime-client-gql";
import { ReactNode } from "react";
import { AuthState } from "../../context/copilot-context";

/**
 * Props for CopilotKit.
 */

export interface CopilotKitProps {
  /**
   *  Your Copilot Cloud API key. Don't have it yet? Go to https://cloud.copilotkit.ai and get one for free.
   */
  publicApiKey?: string;

  /**
   * Restrict input to a specific topic.
   * @deprecated Use `guardrails_c` instead to control input restrictions
   */
  cloudRestrictToTopic?: {
    validTopics?: string[];
    invalidTopics?: string[];
  };

  /**
   * Restrict input to specific topics using guardrails.
   * @remarks
   *
   * This feature is only available when using CopilotKit's hosted cloud service. To use this feature, sign up at https://cloud.copilotkit.ai to get your publicApiKey. The feature allows restricting chat conversations to specific topics.
   */
  guardrails_c?: {
    validTopics?: string[];
    invalidTopics?: string[];
  };

  /**
   * The endpoint for the Copilot Runtime instance. [Click here for more information](/concepts/copilot-runtime).
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
   * Additional headers to be sent with the request.
   *
   * For example:
   * ```json
   * {
   *   "Authorization": "Bearer X"
   * }
   * ```
   */
  headers?: Record<string, string>;

  /**
   * The children to be rendered within the CopilotKit.
   */
  children: ReactNode;

  /**
   * Custom properties to be sent with the request
   * For example:
   * ```js
   * {
   *   'user_id': 'users_id',
   * }
   * ```
   */
  properties?: Record<string, any>;

  /**
   * Indicates whether the user agent should send or receive cookies from the other domain
   * in the case of cross-origin requests.
   */
  credentials?: RequestCredentials;

  /**
   * Whether to show the dev console.
   *
   * If set to "auto", the dev console will be show on localhost only.
   */
  showDevConsole?: boolean | "auto";

  /**
   * The name of the agent to use.
   */
  agent?: string;

  /**
   * The forwarded parameters to use for the task.
   */
  forwardedParameters?: Pick<ForwardedParametersInput, "temperature">;

  /**
   * The auth config to use for the CopilotKit.
   * @remarks
   *
   * This feature is only available when using CopilotKit's hosted cloud service. To use this feature, sign up at https://cloud.copilotkit.ai to get your publicApiKey. The feature allows restricting chat conversations to specific topics.
   */
  authConfig_c?: {
    SignInComponent: React.ComponentType<{
      onSignInComplete: (authState: AuthState) => void;
    }>;
  };

  /**
   * The thread id to use for the CopilotKit.
   */
  threadId?: string;

  /**
   * Config for connecting to Model Context Protocol (MCP) servers.
   * Enables CopilotKit runtime to access tools on external MCP servers.
   *
   * This config merges into the `properties` object with each request as `mcpEndpoints`.
   * It offers a typed method to set up MCP endpoints for requests.
   *
   * Each array item should have:
   * - `endpoint`: MCP server URL (mandatory).
   * - `apiKey`: Optional API key for server authentication.
   *
   * Note: A `createMCPClient` function is still needed during runtime initialization to manage these endpoints.
   */
  mcpEndpoints?: Array<{ endpoint: string; apiKey?: string }>;
}
