import type { BotNode } from "@copilotkit/bot-ui";

/**
 * Render the bot-ui IR tree to a Teams message string.
 *
 * Teams message activities render Markdown, so the structural vocabulary maps
 * cleanly onto it: a `<Header>` becomes a bold line, `<Section>`/`<Markdown>`
 * pass their text through, `<Divider>` becomes a rule, and so on. This is the
 * thin, text-first renderer that covers plain replies and the common card
 * shapes; richer interactive surfaces (buttons, inputs) will render to
 * Adaptive Cards in a follow-up (see the package README).
 */
export function renderTeamsMarkdown(ir: BotNode[]): string {
  return ir
    .map((node) => renderNode(node))
    .filter((s) => s.length > 0)
    .join("\n\n")
    .trim();
}

function renderNode(node: BotNode): string {
  if (typeof node.type !== "string") {
    // Components are expanded to intrinsic nodes before render(); a stray
    // function/symbol node carries no renderable text.
    return collectText(node);
  }

  switch (node.type) {
    case "text":
      return String(node.props.value ?? "");
    case "header":
      return `**${collectText(node)}**`;
    case "divider":
      return "---";
    case "context":
      // Supplementary, lower-emphasis text.
      return collectText(node)
        .split("\n")
        .map((line) => (line ? `_${line}_` : line))
        .join("\n");
    case "field":
      return collectText(node);
    case "fields":
      return childNodes(node)
        .map((c) => renderNode(c))
        .filter(Boolean)
        .join("\n");
    case "button":
      // No interactive surface yet, so render the label so the intent is visible.
      return `\`${collectText(node)}\``;
    case "table":
      return renderTable(node);
    case "message":
    case "section":
    case "markdown":
    case "actions":
    default:
      // Containers and unknown nodes: render children, falling back to any
      // direct text.
      return renderChildren(node) || collectText(node);
  }
}

/**
 * Markdown-table fallback for `<Table>` (the Adaptive Card renderer emits a
 * native Table; this is the text-surface fallback). Teams renders GFM pipe
 * tables in message text.
 */
function renderTable(node: BotNode): string {
  const columns = node.props?.columns as
    | { header: string; align?: "left" | "center" | "right" }[]
    | undefined;
  const rowNodes = childNodes(node).filter((c) => c.type === "row");
  const dataRows = rowNodes.map((r) =>
    childNodes(r)
      .filter((c) => c.type === "cell")
      .map((c) => collectText(c).replace(/\|/g, "\\|")),
  );

  const width =
    columns?.length ?? dataRows.reduce((m, r) => Math.max(m, r.length), 0);
  if (width === 0) return "";

  const headers = columns
    ? columns.map((c) => c.header)
    : Array.from({ length: width }, () => " ");
  const sep = (columns ?? Array.from({ length: width })).map((c) => {
    const align = (c as { align?: string } | undefined)?.align;
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    return "---";
  });

  const line = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;

  return [line(headers), `| ${sep.join(" | ")} |`, ...dataRows.map(line)].join(
    "\n",
  );
}

function renderChildren(node: BotNode): string {
  const kids = childNodes(node);
  if (kids.length === 0) return "";
  return kids
    .map((c) => renderNode(c))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/** Normalize a node's `children` prop to an array of child nodes. */
function childNodes(node: BotNode): BotNode[] {
  const children = node.props?.children;
  if (Array.isArray(children)) return children as BotNode[];
  if (children && typeof children === "object" && "type" in children) {
    return [children as BotNode];
  }
  return [];
}

/** Depth-first collection of a node's descendant text. */
function collectText(node: BotNode): string {
  const out: string[] = [];
  const visit = (n: BotNode): void => {
    if (typeof n.type === "string" && n.type === "text") {
      const value = n.props?.value;
      if (value != null) out.push(String(value));
      return;
    }
    for (const child of childNodes(n)) visit(child);
  };
  visit(node);
  return out.join(" ").replace(/\s+/g, " ").trim();
}
