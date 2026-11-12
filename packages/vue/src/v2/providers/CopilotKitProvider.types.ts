import type {
  ɵCopilotKitLearningOptions,
  ɵCopilotKitProviderBaseOptions,
} from "@copilotkit/core";
import type {
  SandboxFunction,
  VueActivityMessageRenderer,
  VueCustomMessageRenderer,
  VueFrontendTool,
  VueHumanInTheLoop,
  VueToolCallRenderer,
} from "../types";
import type { MarkdownRendererValue } from "./markdown-renderer";
import type { GenerativeUIConfig } from "../generative-ui/runtime-context";

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
   * When you leave it out and the runtime turns generative UI on, the
   * provider uses `standardUI` for the agents of the runtime. It loads the
   * standard components only then.
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
