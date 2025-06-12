import { ForwardedParametersInput } from "@copilotkit/runtime-client-gql";
import { ReactNode } from "react";
import { AuthState } from "../../context/copilot-context";
import { CopilotErrorHandler } from "../../types/error-handler";
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
   * Error handler for CopilotKit errors.
   *
   * This function will be called whenever an error occurs in CopilotKit components,
   * hooks, or API calls. Return 'handled' to suppress the default error behavior,
   * or 'default' to allow the system to handle the error.
   *
   * @example
   * ```tsx
   * <CopilotKit
   *   onError={async (error) => {
   *     if (isCopilotAuthError(error)) {
   *       // Handle auth errors (e.g., refresh token, redirect to login)
   *       await refreshToken();
   *       return 'handled';
   *     }
   *
   *     if (isCopilotNetworkError(error) && error.type === 'rate_limited') {
   *       // Show user-friendly rate limit message
   *       showToast('Too many requests. Please try again later.');
   *       return 'handled';
   *     }
   *
   *     // Log error to monitoring service
   *     logError(error);
   *     return 'default';
   *   }}
   * >
   *   {children}
   * </CopilotKit>
   * ```
   */
  onError?: CopilotErrorHandler;
}
