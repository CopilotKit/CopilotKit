import { Streamdown } from "streamdown";
import type { DefaultMarkdownRendererProps } from "@copilotkit/react-core/v2";

/**
 * A streamdown-backed markdown renderer for the pluggable-renderer demo.
 *
 * CopilotKit no longer bundles streamdown — its built-in renderer is basic GFM
 * (no syntax highlighting / math / diagrams). To get the richer streamdown
 * rendering back, a consuming app installs `streamdown` itself and plugs it in
 * via the pluggable interface (the "escape hatch" — replaces the renderer
 * entirely):
 *
 *   <CopilotKitProvider markdownRenderer={StreamdownRenderer}>
 *
 * A renderer is any component that accepts `{ content: string; isStreaming?: boolean }`.
 */
export function StreamdownRenderer({ content }: { content: string }) {
  return <Streamdown>{content ?? ""}</Streamdown>;
}

/**
 * A config object that *configures the built-in* streaming renderer rather than
 * replacing it — the other half of the pluggable interface. Pass a
 * `DefaultMarkdownRendererProps` object (instead of a component) to slot custom
 * node renderers into CopilotKit's default renderer while keeping its
 * streaming-safe incremental rendering + per-token animation:
 *
 *   <CopilotKitProvider markdownRenderer={customMarkdownConfig}>
 *
 * Defined at module scope (a stable reference) so the provider re-rendering
 * never churns the renderer identity and remounts the streaming subtree.
 * Overrides here merge over the built-in defaults — code blocks and blockquotes
 * get this custom treatment; everything else keeps the built-in rendering.
 */
export const customMarkdownConfig: DefaultMarkdownRendererProps = {
  caret: false,
  nodeRenderers: {
    codeBlock: ({ node }) => (
      <div className="my-2 overflow-hidden rounded-lg border border-emerald-500/40 bg-zinc-900">
        <div className="flex items-center justify-between bg-zinc-800 px-3 py-1.5 font-mono text-xs text-emerald-400">
          <span>{node.info || "code"}</span>
          <span className="text-zinc-500">custom config renderer</span>
        </div>
        <pre className="overflow-x-auto p-3 text-sm text-emerald-100">
          <code>{node.text}</code>
        </pre>
      </div>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-4 border-emerald-500 bg-emerald-50 px-4 py-2 italic text-zinc-700">
        {children}
      </blockquote>
    ),
  },
};
