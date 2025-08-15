import { ForwardedParametersInput } from "@copilotkit/runtime-client-gql";
import { ReactNode } from "react";
import { AuthState } from "../../context/copilot-context";
import { CopilotErrorHandler } from "@copilotkit/shared";
/**
 * Props for CopilotKit.
 */

export interface CopilotKitProps {
  /**
   * Your Copilot Cloud API key.
   *
   * Don't have it yet? Go to https://cloud.copilotkit.ai and get one for free.
   */
  publicApiKey?: string;

  /**
   * Your public license key for accessing premium CopilotKit features.
   *
   * Don't have it yet? Go to https://cloud.copilotkit.ai and get one for free.
   */
  publicLicenseKey?: string;

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
   * Can include threadMetadata for thread creation and authorization for LangGraph Platform authentication.
   * For example:
   * ```js
   * {
   *   'user_id': 'users_id',
   *   'authorization': 'your-auth-token', // For LangGraph Platform authentication
   *   threadMetadata: {
   *     'account_id': '123',
   *     'user_type': 'premium'
   *   }
   * }
   * ```
   *
   * **Note**: The `authorization` property is automatically forwarded to LangGraph agents. See the [LangGraph Agent Authentication Guide](/coagents/shared/guides/langgraph-platform-authentication) for details.
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
   * Set to `true` to show error banners and toasts, `false` to hide all error UI.
   * Defaults to `false` for production safety.
   */
  showDevConsole?: boolean;

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
   * Optional error handler for comprehensive debugging and observability.
   *
   * **Requires publicApiKey**: Error handling only works when publicApiKey is provided.
   * This is a premium Copilot Cloud feature.
   *
   * @param errorEvent - Structured error event with rich debugging context
   *
   * @example
   * ```typescript
   * <CopilotKit
   *   publicApiKey="ck_pub_your_key"
   *   onError={(errorEvent) => {
   *     debugDashboard.capture(errorEvent);
   *   }}
   * >
   * ```
   */
  onError?: CopilotErrorHandler;
}
