/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — CopilotKitProps:
 *   V2 import and usage:
 *     import type { CopilotKitProps } from "@copilotkit/react-core/v2";
 *     type V2CopilotKitProps = CopilotKitProps;
 *   V2 replacement source: packages/react-core/src/v1-deprecated/components/copilot-provider/copilotkit-props.tsx
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { ForwardedParametersInput } from "@copilotkit/runtime-client-gql";
import type { ReactNode } from "react";
import type { AuthState } from "../../context/copilot-context";
import type { CopilotErrorHandler, DebugConfig } from "@copilotkit/shared";
import type { CopilotKitHeadersSource } from "@copilotkit/core";
import type { CopilotKitProviderProps } from "../../../v2";
/**
 * Props for CopilotKit.
 */

/**
 * We shouldn't need this `Omit` here, but using it because `CopilotKitProps`
 * and `CopilotKitProviderProps` have non-identical `children` types
 *
 * TODO: Remove this `Omit` once this is resolved.
 */
export interface CopilotKitProps extends Omit<
  CopilotKitProviderProps,
  "children" | "onError"
> {
  /** Your CopilotKit public license key. */
  publicApiKey?: string;

  /** Your public license key for accessing CopilotKit Intelligence features. */
  publicLicenseKey?: string;

  /**
   * Restrict input to a specific topic.
   * @deprecated Use `guardrails_c` instead to control input restrictions
   */
  cloudRestrictToTopic?: {
    validTopics?: string[];
    invalidTopics?: string[];
  };

  /** @internal Defunct — retained for backward compatibility. */
  guardrails_c?: {
    validTopics?: string[];
    invalidTopics?: string[];
  };

  /**
   * The endpoint for the Copilot Runtime instance. [Click here for more information](/backend/copilot-runtime).
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
   * Can be a static object, a synchronous builder, or an async builder
   * (useful for refreshing auth tokens). Whichever form you use, it is
   * evaluated when each request is sent, not when this component renders.
   *
   * For example:
   * ```tsx
   * // Static headers
   * headers={{ "Authorization": "Bearer X" }}
   *
   * // Synchronous builder, evaluated at send time
   * headers={() => ({ "Authorization": `Bearer ${getToken()}` })}
   *
   * // Async builder, evaluated (and awaited) at send time
   * headers={async () => ({ "Authorization": `Bearer ${await getToken()}` })}
   * ```
   *
   * An async builder is only awaited on the request paths served by
   * `<CopilotKit>`'s v2 provider (agent runs, threads, the inspector, and
   * so on). The legacy v1 `CopilotTask` / GraphQL path (and anything else
   * that reads the internal `copilotApiConfig.headers` snapshot) never
   * awaits it: an async builder is called once, its result (and any
   * rejection) is discarded, and every read there gets an empty object
   * instead, with one console warning per provider instance in development.
   *
   * Cache inside the builder. Clerk's and Auth0's `getToken()` already
   * cache. A builder that calls the network every time adds one call per
   * request.
   *
   * If the builder throws or rejects, that request is not sent and
   * `onError` gets `header_resolution_failed`.
   *
   * Passing the same builder again, or a new builder function, does not
   * reload anything, because the provider keeps one stable wrapper. On a
   * user switch, remount the provider (for example `key={userId}`) so
   * thread lists and Inspector metadata reload for the new user.
   *
   * Core headers are also sent to any self-managed agent registered
   * directly with CopilotKit, including ones on other origins. Don't put a
   * bearer token in core headers if those agents point at a third party.
   */
  headers?: CopilotKitHeadersSource;

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
   * **Note**: The `authorization` property is automatically forwarded to LangGraph agents. See the [LangGraph Agent Authentication Guide](/auth) for details.
   */
  properties?: Record<string, any>;

  /**
   * Indicates whether the user agent should send or receive cookies from the other domain
   * in the case of cross-origin requests.
   *
   * To enable HTTP-only cookie authentication, set `credentials="include"` and configure
   * CORS on your runtime endpoint:
   *
   * ```tsx
   * // Frontend (https://myapp.com)
   * <CopilotKit runtimeUrl="https://api.myapp.com/copilotkit" credentials="include">
   *   {children}
   * </CopilotKit>
   *
   * // Backend (https://api.myapp.com)
   * copilotRuntimeNextJSAppRouterEndpoint({
   *   runtime,
   *   endpoint: "/copilotkit",
   *   cors: {
   *     origin: "https://myapp.com",
   *     credentials: true,
   *   },
   * });
   * ```
   */
  credentials?: RequestCredentials;

  /**
   * Whether to show the dev console (error banners and toasts).
   *
   * @deprecated Use `enableInspector` to control the AG-UI inspector,
   * which is what most users want. `showDevConsole` only controls
   * error toasts/banners, not the inspector button.
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

  /** @internal Defunct — retained for backward compatibility. */
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
   * @param errorEvent - Structured error event with rich debugging context
   *
   * @example
   * ```typescript
   * <CopilotKit
   *   onError={(errorEvent) => {
   *     debugDashboard.capture(errorEvent);
   *   }}
   * >
   * ```
   */
  onError?: CopilotErrorHandler;

  /**
   * Enable or disable the CopilotKit Inspector, letting you inspect AG-UI events,
   * view agent messages, check agent state, and visualize agent context. The
   * Inspector is enabled by default in development browser builds and is always
   * disabled in production and during server rendering.
   */
  enableInspector?: boolean;

  /**
   * Enable debug logging. On the server (`CopilotRuntime`), this enables
   * structured Pino logging of the AG-UI event pipeline. On the client,
   * this configuration is forwarded to the AG-UI transport layer
   * (`transformChunks`) for transport-level debug output.
   *
   * Pass `true` for full output, or an object for granular control:
   *
   * ```tsx
   * <CopilotKit debug={true} runtimeUrl="...">
   *   {children}
   * </CopilotKit>
   * ```
   */
  debug?: DebugConfig;
}
