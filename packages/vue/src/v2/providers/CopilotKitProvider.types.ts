import type { AbstractAgent } from "@ag-ui/client";
import type {
  CopilotKitCoreErrorCode,
  CopilotKitHeadersSource,
  CopilotKitMessageFilter,
} from "@copilotkit/core";
import type { DebugConfig } from "@copilotkit/shared";
import type {
  A2UITheme,
  SandboxFunction,
  VueActivityMessageRenderer,
  VueCustomMessageRenderer,
  VueFrontendTool,
  VueHumanInTheLoop,
  VueToolCallRenderer,
} from "../types";
import type { Component } from "vue";
import type { GenerativeUIConfig } from "../generative-ui/runtime-context";

/**
 * Host-side options for MCP Apps widgets, set on `<CopilotKitProvider
 * :mcp-apps="...">`. The same shape Angular's `provideMCPApps()` takes; every
 * field is optional and merged over the shared defaults.
 */
export interface MCPAppsOptions {
  /** Maximum time to wait for a busy agent before a queued request fails. */
  idleTimeoutMs?: number;
  /** Maximum time to wait for the sandbox proxy initialization handshake. */
  initializationTimeoutMs?: number;
  /** Host identity announced during the MCP Apps initialization handshake. */
  hostInfo?: { name: string; version: string };
  /** Additional protocol capabilities announced to embedded MCP Apps. */
  hostCapabilities?: Record<string, unknown>;
  /**
   * Additional non-secret UI context announced to embedded MCP Apps.
   * `availableDisplayModes` narrows the display modes widgets may obtain
   * (`inline` always stays); `theme` overrides the `.dark` detection.
   */
  hostContext?: Record<string, unknown>;
  /**
   * Restore `allow-same-origin` on the MCP App sandbox. Default `false`.
   *
   * **Unsafe.** The widget then runs with your page's origin: it can read
   * your cookies, storage and DOM, and call your APIs as the signed-in user.
   * Only set it for widgets you wrote and trust that need `localStorage`,
   * `IndexedDB` or cookies. By default widgets get an opaque origin.
   */
  allowSameOriginFallback?: boolean;
}

export interface CopilotKitProviderProps {
  runtimeUrl?: string;
  /**
   * Headers sent with every request. A record, or a sync or async builder
   * that runs when each request is sent. An inline arrow is fine. The builder
   * should be cheap; cache tokens in it.
   */
  headers?: CopilotKitHeadersSource;
  credentials?: RequestCredentials;
  /**
   * Rewrites the message list sent to runtime agents on every run.
   *
   * CopilotKit sends the whole thread each time. When your agent already
   * stores the conversation, most of that payload is waste, and an agent that
   * merges the inbound list with its own store can show the model every turn
   * twice. Return the messages to send:
   *
   * ```vue
   * <CopilotKitProvider
   *   runtime-url="/api/copilotkit"
   *   :message-filter="(messages) => messages.slice(-1)"
   * />
   * ```
   *
   * The filter changes the request body only. The transcript the UI renders is
   * untouched. Broken tool-call pairs are repaired before the request is sent,
   * so a filter this blunt cannot strand a tool result mid-HITL.
   *
   * Agents reached through your CopilotRuntime honor this. An agent your app
   * passes in directly does not, and neither Intelligence runs nor suggestion
   * runs are ever filtered.
   */
  messageFilter?: CopilotKitMessageFilter;
  defaultThrottleMs?: number;
  publicApiKey?: string;
  publicLicenseKey?: string;
  /**
   * Signed license token for offline verification of CopilotKit Intelligence features.
   * Obtain from https://dashboard.operations.copilotkit.ai.
   */
  licenseToken?: string;
  properties?: Record<string, unknown>;
  useSingleEndpoint?: boolean;
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  selfManagedAgents?: Record<string, AbstractAgent>;
  renderToolCalls?: VueToolCallRenderer<any>[];
  renderActivityMessages?: VueActivityMessageRenderer<unknown>[];
  renderCustomMessages?: VueCustomMessageRenderer[];
  frontendTools?: VueFrontendTool[];
  humanInTheLoop?: VueHumanInTheLoop[];
  openGenerativeUI?: {
    sandboxFunctions?: SandboxFunction[];
    designSkill?: string;
  };
  /**
   * @deprecated This prop no longer controls the Inspector. Use
   * `enableInspector` instead.
   */
  showDevConsole?: boolean | "auto";
  /**
   * Disable the CopilotKit Inspector in development.
   * The Inspector is enabled by default in development browser builds and is
   * always disabled in production and during server rendering.
   */
  enableInspector?: boolean;
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void | Promise<void>;
  a2ui?: {
    theme?: A2UITheme;
    catalog?: any;
    loadingComponent?: Component;
    /**
     * When true (the default), the full component schemas from the catalog are
     * sent as agent context so the agent knows what components and props are
     * available. The A2UI middleware can overwrite this with a server-side
     * schema if configured.
     *
     * When false, the agent context still describes the catalog, but only by its
     * catalog ID and the names of its custom components, without their JSON
     * schemas. The component schema entry and the A2UI generation and design
     * guidelines are not sent. With the CopilotKit LangGraph middleware's
     * injected A2UI tool, the A2UI subagent then gets the component names only;
     * a host can still give it a composition guide through the middleware's
     * guidelines (`a2uiParams.guidelines.compositionGuide` in TypeScript,
     * `a2ui_params["guidelines"]["composition_guide"]` in Python).
     */
    includeSchema?: boolean;
  };
  /**
   * Experimental. Native generative UI. Pass `ui` from `createGenerativeUI`,
   * and the agent renders your Vue components in the chat or in a
   * `<GenerativeUISurface id>` on the page. The library binds the props that
   * match the declared state and the events that match the declared
   * functions. The model does not see them.
   *
   * Bind it in camelCase, as `:generativeUI`. Vue reads the kebab-case
   * `:generative-ui` as a different prop (`generativeUi`).
   *
   * @example
   * ```vue
   * <CopilotKitProvider runtime-url="/api/copilotkit" :generativeUI="{ ui }">
   *   <CopilotChat />
   * </CopilotKitProvider>
   * ```
   */
  generativeUI?: GenerativeUIConfig;
  /**
   * Host-side options for MCP Apps widgets. Optional; use it to narrow what
   * widgets may obtain, for example
   * `{ hostContext: { availableDisplayModes: ["inline"] } }` keeps them inline.
   */
  mcpApps?: MCPAppsOptions;
  /**
   * Enable debug logging for the client-side event pipeline.
   *
   * Accepts:
   * - `true` / `false` to toggle events + lifecycle logging (verbose off).
   * - `{ events?: boolean; lifecycle?: boolean; verbose?: boolean }` for granular control.
   */
  debug?: DebugConfig;
}
