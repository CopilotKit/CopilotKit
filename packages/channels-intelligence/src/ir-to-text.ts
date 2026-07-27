import type { ChannelNode } from "@copilotkit/channels-ui";

/**
 * Flatten Bot UI IR (`ChannelNode[]`) to plain text for the Intelligence egress
 * first slice, which accepts a plain `text` field only (Intelligence owns the
 * native platform rendering later via per-platform codecs — OSS-363/OSS-377).
 *
 * The dominant Channel path — streamed agent text — is already a single
 * `{ type: "text", props: { value } }` node (see {@link IntelligenceAdapter}'s
 * run renderer), so this is usually a no-op concat. Richer IR (sections, lists)
 * is best-effort flattened by concatenating descendant text; formatting is lost
 * until Intelligence honors the IR end to end.
 *
 * TODO(OSS-377): drop once Intelligence renders IR via the shared codecs.
 */
export function irToText(ir: ChannelNode[]): string {
  return ir
    .map((node) => nodeToText(node))
    .filter((s) => s.length > 0)
    .join("\n")
    .trim();
}

/** Recursively collect text from a node tree. Inline children concat with ""; block siblings join with "\n" at the top level. */
function nodeToText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (typeof node === "object") {
    const n = node as { type?: unknown; props?: Record<string, unknown> };
    const props = n.props ?? {};
    if (n.type === "text" && typeof props["value"] === "string") {
      return props["value"];
    }
    return nodeToText(props["children"]);
  }
  return "";
}
