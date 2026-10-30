import type { A2UIRecoveryRendererOptions } from "../components/a2ui/A2UIRecoveryStates";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  CopilotKitCoreErrorCode,
  CopilotKitHeadersSource,
  CopilotKitMessageFilter,
  LearningConfig,
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
import type { MarkdownRendererValue } from "./markdown-renderer";

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
   * CSP nonce for the `<style>` tag CopilotKit adds. Set it when your
   * Content-Security-Policy limits `style-src` to a nonce.
   */
  nonce?: string;
  /**
   * Set to `false` when you import `@copilotkit/core/styles.css` yourself, so
   * browsers cache the CSS as a file. CopilotKit then adds no `<style>` tag.
   * @default true
   */
  injectStyles?: boolean;
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
    /**
     * Options for the A2UI error-recovery status UI: how long before the
     * transient "Retrying…" hint appears, after how many attempts, and how
     * much retry/debug detail to surface. When omitted, defaults apply.
     */
    recovery?: A2UIRecoveryRendererOptions;
  };
  /** Configuration for the built-in MCP Apps renderer. */
  mcpApps?: {
    /**
     * Restore `allow-same-origin` on the MCP App sandbox. Default `false`.
     *
     * **Unsafe.** The widget then runs with your page's origin: it can read
     * your cookies, storage and DOM, and call your APIs as the signed-in user.
     * Only set it for widgets you wrote and trust that need `localStorage`,
     * `IndexedDB` or cookies. By default widgets get an opaque origin.
     */
    allowSameOriginFallback?: boolean;
  };
  /**
   * Global markdown renderer for assistant/reasoning messages. Either a Vue
   * component (escape hatch — receives `{ content: string; isStreaming?: boolean }`)
   * or a `DefaultMarkdownRendererProps` config object (e.g.
   * `{ nodeRenderers: { codeBlock: ShikiBlock } }`) to configure the built-in
   * streaming renderer without writing a wrapper. Overrides the built-in default;
   * a per-message slot still wins.
   */
  markdownRenderer?: MarkdownRendererValue;
  /**
   * Enable debug logging for the client-side event pipeline.
   *
   * Accepts:
   * - `true` / `false` to toggle events + lifecycle logging (verbose off).
   * - `{ events?: boolean; lifecycle?: boolean; verbose?: boolean }` for granular control.
   */
  debug?: DebugConfig;
  /**
   * Turns on interaction capture (`@copilotkit/learning`). `learning` (short
   * for `:learning="true"`) records with the default options; pass an object
   * for options. `false` or omitting the prop turns capture off and cancels
   * startup. Without a sink, Core authenticates with the runtime and sends
   * browser events to Intelligence; a custom sink keeps the standalone
   * collector behavior. Updated settings apply to the next Trajectory.
   *
   * Capture starts after mount. Set `trajectoryId` to use your own ID;
   * otherwise the provider generates one. The generated ID stays the same
   * across rerenders, reconnects and option changes; turning capture off,
   * setting `autoStart: false` or supplying a `trajectoryId` ends it, and the
   * next generated Trajectory gets a new ID. Read the active ID from
   * `copilotkit.trajectoryId`.
   *
   * Set `autoStart: false` to start capture yourself with `startTrajectory()`.
   * Capture stops on unmount, including manually started Trajectories.
   *
   * @example
   * <CopilotKitProvider runtime-url="/api/copilotkit" learning>
   */
  learning?: boolean | CopilotKitLearningOptions;
}

/** The object form of the `learning` prop. */
export type CopilotKitLearningOptions = LearningConfig & {
  /**
   * Starts a Trajectory after mount. Defaults to `true`; set `false` to call
   * `startTrajectory()` yourself.
   */
  autoStart?: boolean;
  trajectoryId?: string;
  /**
   * Used only by explicit custom sinks. Authenticated capture warns and ignores
   * this option; assign Learning Spaces on the server with
   * `getTrajectoryLearningContainerIds` on `CopilotKitIntelligence`.
   */
  learningContainerIds?: string[];
};
