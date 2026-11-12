/*
 * A generated guide as markdown, for the reader's coding agent: the guide
 * surface's components, walked from its root. Only the document components
 * of the guide target (GUIDE_COMPONENTS) carry text; layout passes through
 * to its children, and controls (buttons, inputs) drop out.
 */

type Node = Record<string, unknown> & { id: string; component: string };

interface Operation {
  createSurface?: { components?: Node[] };
  updateComponents?: { components?: Node[] };
}

/** Every component an operation carries: A2UI 1.0 lets createSurface too. */
export function componentsOf(operations: readonly unknown[]): Node[] {
  return (operations as Operation[]).flatMap((op) => [
    ...(op?.createSurface?.components ?? []),
    ...(op?.updateComponents?.components ?? []),
  ]);
}

/** A data binding (`{ "@path": "/x" }`) resolved; anything else as is. */
function resolve(value: unknown, data: unknown, scope: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "@path" in value &&
    typeof (value as { "@path": unknown })["@path"] === "string"
  ) {
    const path = (value as { "@path": string })["@path"];
    const absolute = path.startsWith("/");
    let at: unknown = absolute ? data : scope;
    for (const key of path.split("/").filter(Boolean)) {
      at =
        at && typeof at === "object"
          ? (at as Record<string, unknown>)[key]
          : undefined;
    }
    return at;
  }
  return value;
}

/**
 * Text with its line breaks. A model sometimes escapes them twice in its
 * render_ui JSON, so a block arrives as one line with literal "\n"s; a
 * text with no real line break but literal ones gets them back.
 */
export function withLineBreaks(text: string) {
  return !text.includes("\n") && text.includes("\\n")
    ? text.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
    : text;
}

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** Title sizes to heading levels: the guide's title, its steps, and below. */
function headingLevel(size: unknown) {
  if (size === "sm" || size === "md" || size === undefined) return 3;
  if (size === "lg" || size === "xl") return 2;
  return 1;
}

/** Components that sit on one line when a Row holds only them. */
const INLINE = new Set([
  "Badge",
  "Text",
  "Caption",
  "Label",
  "Bold",
  "Italic",
  "Link",
]);

export interface GuideDocument {
  title: string | null;
  markdown: string;
}

/**
 * The guide's markdown, from the operations that built its surface and its
 * data model. Relative links become absolute against `origin`, so an agent
 * outside the docs can follow them.
 */
export function guideToMarkdown(
  operations: readonly unknown[],
  data: unknown,
  origin: string,
): GuideDocument {
  const nodes = new Map<string, Node>();
  for (const node of componentsOf(operations)) {
    if (node && typeof node.id === "string") nodes.set(node.id, node);
  }
  const referenced = new Set<string>();
  for (const node of nodes.values()) {
    for (const id of childIds(node)) referenced.add(id);
  }
  const rootId = nodes.has("root")
    ? "root"
    : [...nodes.keys()].find((id) => !referenced.has(id));

  let title: string | null = null;
  const href = (value: unknown) => {
    const raw = text(value);
    try {
      return raw ? new URL(raw, origin).toString() : "";
    } catch {
      return raw;
    }
  };

  function inline(node: Node, scope: unknown): string {
    const v = (key: string) => text(resolve(node[key], data, scope));
    switch (node.component) {
      case "Badge":
        return `\`${v("label")}\``;
      case "Bold":
        return `**${v("text")}**`;
      case "Italic":
        return `_${v("text")}_`;
      case "Link":
        return `[${v("text")}](${href(resolve(node.href, data, scope))})`;
      default:
        return v("text");
    }
  }

  function children(node: Node, scope: unknown): string[] {
    const list = resolve(node.children, data, scope);
    if (Array.isArray(list)) {
      return list.flatMap((id) =>
        typeof id === "string" ? walk(id, scope) : [],
      );
    }
    // A template: one copy of a component per item of a list in the data.
    if (list && typeof list === "object" && "componentId" in list) {
      const { componentId, path } = list as {
        componentId: string;
        path: string;
      };
      const items = resolve({ "@path": path }, data, scope);
      return Array.isArray(items)
        ? items.flatMap((item) => walk(componentId, item))
        : [];
    }
    return typeof node.child === "string" ? walk(node.child, scope) : [];
  }

  function walk(id: string, scope: unknown): string[] {
    const node = nodes.get(id);
    if (!node) return [];
    const v = (key: string) => text(resolve(node[key], data, scope));
    switch (node.component) {
      case "Title": {
        const level = headingLevel(node.size);
        if (title === null) title = v("text");
        return [`${"#".repeat(level)} ${v("text")}`];
      }
      case "Text":
      case "Caption":
      case "Label":
      case "Bold":
      case "Italic":
      case "Underline":
      case "Strikethrough":
      case "Badge":
      case "Link":
        return [inline(node, scope)];
      case "Markdown":
        return [withLineBreaks(v("text"))];
      case "Code":
        return [
          "```" +
            v("language") +
            "\n" +
            withLineBreaks(v("text")).replace(/\n$/, "") +
            "\n```",
        ];
      case "Blockquote":
        return [
          v("text")
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        ];
      case "Divider":
        return ["---"];
      case "CheckBox":
        return [`- [ ] ${v("label")}`];
      case "LinkCard": {
        const description = v("description");
        return [
          `- [${v("title")}](${href(resolve(node.href, data, scope))})${description ? `: ${description}` : ""}`,
        ];
      }
      case "ListItem":
        return [listLine(node, scope, "-")];
      case "List": {
        const marker = node.marker === "number" ? "1." : "-";
        const items = resolve(node.items, data, scope);
        const lines = Array.isArray(items)
          ? items.map((item) =>
              typeof item === "string"
                ? `${marker} ${item}`
                : listLine(item as Node, scope, marker),
            )
          : [];
        return [[...lines, ...children(node, scope)].join("\n")];
      }
      case "Tabs": {
        const tabs = Array.isArray(node.tabs) ? node.tabs : [];
        return tabs.flatMap((tab: { title?: unknown; child?: unknown }) => [
          `**${text(resolve(tab.title, data, scope))}**`,
          ...(typeof tab.child === "string" ? walk(tab.child, scope) : []),
        ]);
      }
      case "Table":
        return [table(node, scope)];
      case "Row": {
        const ids = resolve(node.children, data, scope);
        if (
          Array.isArray(ids) &&
          ids.every((cid) =>
            INLINE.has(nodes.get(String(cid))?.component ?? ""),
          )
        ) {
          return [
            ids
              .map((cid) => inline(nodes.get(String(cid))!, scope))
              .filter(Boolean)
              .join(" · "),
          ];
        }
        return children(node, scope);
      }
      case "Button":
      case "Pressable":
      case "TextField":
      case "TextArea":
      case "Select":
      case "Radio":
      case "RadioGroup":
      case "SegmentedControl":
      case "ChoicePicker":
      case "FollowUp":
        return [];
      default:
        return children(node, scope);
    }
  }

  function listLine(item: Node, scope: unknown, marker: string) {
    const v = (key: string) => text(resolve(item[key], data, scope));
    const label = v("label");
    const value = v("value");
    const description = v("description");
    return `${marker} ${label ? `**${label}**` : ""}${value ? ` ${value}` : ""}${description ? `: ${description}` : ""}`.trimEnd();
  }

  function table(node: Node, scope: unknown) {
    const columns = Array.isArray(node.columns)
      ? node.columns.map((c) =>
          typeof c === "string" ? c : text((c as { label?: unknown }).label),
        )
      : [];
    const rows = resolve(node.rows, data, scope);
    const body = Array.isArray(rows)
      ? rows.map((row) =>
          Array.isArray(row)
            ? row.map((cell) => {
                if (typeof cell === "string" && nodes.has(cell)) {
                  return walk(cell, scope).join(" ");
                }
                return text(resolve(cell, data, scope));
              })
            : [],
        )
      : [];
    // A table built from TableSection / TableRow / TableCell parts.
    if (!columns.length && !body.length) {
      const parts: string[][] = [];
      const collect = (id: string) => {
        const part = nodes.get(id);
        if (!part) return;
        if (part.component === "TableRow") {
          parts.push(childIds(part).map((cid) => walk(cid, scope).join(" ")));
        } else {
          childIds(part).forEach(collect);
        }
      };
      childIds(node).forEach(collect);
      const [head = [], ...rest] = parts;
      return gfm(head, rest);
    }
    return gfm(columns, body);
  }

  const blocks = rootId ? walk(rootId, undefined) : [];
  return {
    title,
    markdown: blocks
      .map((block) => block.trim())
      .filter(Boolean)
      .join("\n\n"),
  };
}

function childIds(node: Node): string[] {
  const ids: string[] = [];
  if (Array.isArray(node.children)) {
    for (const id of node.children) if (typeof id === "string") ids.push(id);
  } else if (
    node.children &&
    typeof node.children === "object" &&
    "componentId" in node.children
  ) {
    ids.push(String((node.children as { componentId: unknown }).componentId));
  }
  if (typeof node.child === "string") ids.push(node.child);
  if (Array.isArray(node.tabs)) {
    for (const tab of node.tabs as { child?: unknown }[]) {
      if (typeof tab.child === "string") ids.push(tab.child);
    }
  }
  return ids;
}

function gfm(head: string[], rows: string[][]) {
  if (!head.length) return "";
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${head.map(cell).join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}
