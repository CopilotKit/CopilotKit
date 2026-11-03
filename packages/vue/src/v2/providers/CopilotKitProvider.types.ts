import type { A2UIRecoveryRendererOptions } from "../components/a2ui/A2UIRecoveryStates";
import type {
  ɵA2UIBaseOptions,
  ɵCopilotKitLearningOptions,
  ɵCopilotKitProviderBaseOptions,
} from "@copilotkit/core";
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

export interface CopilotKitProviderProps extends ɵCopilotKitProviderBaseOptions {
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
   * Disable the CopilotKit Inspector in development.
   * The Inspector is enabled by default in development browser builds and is
   * always disabled in production and during server rendering.
   */
  enableInspector?: boolean;
  a2ui?: ɵA2UIBaseOptions & {
    theme?: A2UITheme;
    catalog?: any;
    loadingComponent?: Component;
    /**
     * Options for the A2UI error-recovery status UI: how long before the
     * transient "Retrying…" hint appears, after how many attempts, and how
     * much retry/debug detail to surface. When omitted, defaults apply.
     */
    recovery?: A2UIRecoveryRendererOptions;
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
}

/** The object form of the `learning` prop. */
export type CopilotKitLearningOptions = ɵCopilotKitLearningOptions;
