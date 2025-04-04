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
   * Custom properties to be sent with the request.
   * These properties are accessible in the runtime via `graphqlContext.properties`
   * and can be used for custom logic, including dynamic configuration.
   *
   * @example
   * // Pass arbitrary data, including dynamic MCP endpoint configurations:
   * const myProps = {
   *   user_id: 'user123',
   *   session_theme: 'dark',
   *   mcpEndpoints: [
   *     { endpoint: "https://dynamic-mcp.example.com" }
   *     // ... other request-specific endpoints
   *   ]
   * };
   * // Then use in your component:
   * // <CopilotKit properties={myProps}> ... </CopilotKit>
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
   * Configuration for connecting to Model Context Protocol (MCP) servers.
   * Allows the CopilotKit runtime to discover and utilize tools hosted
   * on external MCP-compliant servers.
   *
   * If provided, this configuration will be merged into the `properties` object
   * sent with each request under the key `mcpEndpoints`.
   * It provides a strongly-typed way to configure request-specific MCP endpoints.
   *
   * Each object in the array should contain:
   * - `endpoint`: The URL of the MCP server (required).
   * - `apiKey`: An optional API key if the server requires authentication.
   *
   * @example
   * <CopilotKit
   *   mcpEndpoints={[
   *     { endpoint: "https://my-mcp-server.com/api" },
   *     { endpoint: "https://another-mcp.dev", apiKey: "secret-key" },
   *   ]}
   * >
   *   // ... your components
   * </CopilotKit>
   *
   * Note: The runtime still requires a `createMCPClient` function to be provided
   * during its initialization to handle these endpoints.
   * @experimental
   */
  mcpEndpoints?: Array<{ endpoint: string; apiKey?: string }>;
}
