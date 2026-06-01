import { Streamdown } from "streamdown";

/**
 * A streamdown-backed markdown renderer for the pluggable-renderer demo.
 *
 * CopilotKit no longer bundles streamdown — its built-in renderer is basic GFM
 * (no syntax highlighting / math / diagrams). To get the richer streamdown
 * rendering back, a consuming app installs `streamdown` itself and plugs it in
 * via the pluggable interface:
 *
 *   <CopilotKitProvider markdownRenderer={StreamdownRenderer}>
 *
 * A renderer is any component that accepts `{ content: string; isStreaming?: boolean }`.
 */
export function StreamdownRenderer({ content }: { content: string }) {
  return <Streamdown>{content ?? ""}</Streamdown>;
}
