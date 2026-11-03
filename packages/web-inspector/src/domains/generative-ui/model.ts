import {
  GENERATIVE_UI_ROOT_ID,
  childIdsAtRefs,
  collectChildRefs,
} from "@copilotkit/shared";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIComponentManifest,
  GenerativeUITemplateChildren,
} from "@copilotkit/shared";
import type {
  ɵGenerativeUIDebugPromptSection,
  ɵGenerativeUIDebugSnapshot,
} from "@copilotkit/core";

export type GenerativeUITab = "surfaces" | "catalog" | "prompt";

export const TABS: ReadonlyArray<{ key: GenerativeUITab; label: string }> = [
  { key: "surfaces", label: "Surfaces" },
  { key: "catalog", label: "Catalog" },
  { key: "prompt", label: "Prompt" },
];

export const PROMPT_SOURCE_NOTES: Record<
  ɵGenerativeUIDebugPromptSection["source"],
  string
> = {
  runtime:
    "The runtime adds this text as a context entry, with the render_ui tool.",
  context: "The provider sends this text as a context entry.",
  backend:
    "sendContext is false. Your backend builds the prompt, usually from this text.",
};

/** A rough token count: about 4 characters for each token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatTokens(text: string) {
  return `~${estimateTokens(text).toLocaleString()} tokens`;
}

export function json(value: unknown) {
  return JSON.stringify(value, null, 2) ?? "undefined";
}

/** The kind of an A2UI operation, for example `updateComponents`. */
export function operationKind(operation: unknown): string {
  if (typeof operation !== "object" || operation === null) return "unknown";
  return Object.keys(operation).find((key) => key !== "version") ?? "unknown";
}

/** One component of a surface, as the browser renders it. */
export interface ComponentTreeNode {
  id: string;
  component: string;
  /** The props that are not slots, as the model wrote them. */
  props: Record<string, unknown>;
  /** Set when a template repeats the component for each item at this path. */
  repeat?: string;
  children: ComponentTreeNode[];
}

/**
 * The component tree of a surface, from its root. Later operations replace
 * components with the same id. Skipped operations (rejected by the browser)
 * are left out. A slot id with no component yet is left out too.
 */
export function componentTree(
  operations: readonly A2UIOperation[],
  skip: ReadonlySet<number>,
  catalog: Record<string, GenerativeUIComponentManifest>,
): ComponentTreeNode | undefined {
  const byId = new Map<string, A2UIComponentNode>();
  operations.forEach((operation, index) => {
    if (skip.has(index)) return;
    const components =
      "createSurface" in operation
        ? operation.createSurface.components
        : "updateComponents" in operation
          ? operation.updateComponents.components
          : undefined;
    for (const node of components ?? []) byId.set(node.id, node);
  });
  const seen = new Set<string>();
  const build = (id: unknown, repeat?: string): ComponentTreeNode[] => {
    const node = typeof id === "string" ? byId.get(id) : undefined;
    // The browser rejects cycles. The guard keeps a bad snapshot from looping.
    if (!node || seen.has(node.id)) return [];
    seen.add(node.id);
    const { id: _id, component, ...rest } = node;
    const manifest = catalog[component];
    // A child is in a slot, or at a `child()` / `childList()` ref of the
    // props. A top-level ref reads like a slot. A deeper ref (the `child` of
    // each tab) stays in the props, and its ids become children too.
    const refs = manifest ? collectChildRefs(manifest.props) : [];
    const childKeys = new Set([
      ...Object.keys(manifest?.slots ?? {}),
      ...refs.filter((ref) => ref.path.length === 1).map((ref) => ref.path[0]),
    ]);
    const nested = refs.filter((ref) => ref.path.length > 1);
    const props: Record<string, unknown> = {};
    const children: ComponentTreeNode[] = [];
    for (const [name, value] of Object.entries(rest)) {
      if (!childKeys.has(name)) props[name] = value;
      else if (Array.isArray(value)) {
        for (const child of value) children.push(...build(child));
      } else if (typeof value === "object" && value !== null) {
        const template = value as Partial<GenerativeUITemplateChildren>;
        children.push(...build(template.componentId, template.path));
      } else children.push(...build(value));
    }
    for (const child of childIdsAtRefs(rest, nested)) {
      children.push(...build(child));
    }
    return [
      {
        id: node.id,
        component,
        props,
        ...(repeat ? { repeat } : {}),
        children,
      },
    ];
  };
  return build(GENERATIVE_UI_ROOT_ID)[0];
}

/** The first element of the page whose `attribute` is `value`. */
export function findOnPage(attribute: string, value: string) {
  return [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(
    (element) => element.getAttribute(attribute) === value,
  );
}

/**
 * The function problem that the inspector shows. A function goes to the
 * model only with exactly one mounted handler.
 */
/**
 * Splits components by the catalog that declared them: the catalog of the
 * provider first, then each base in the order of `extends`.
 */
export function groupByCatalog<Entry extends [string, unknown]>(
  components: Entry[],
  snapshot: Pick<ɵGenerativeUIDebugSnapshot, "catalogId" | "componentCatalogs">,
): [string, Entry[]][] {
  const groups = new Map<string, Entry[]>([[snapshot.catalogId, []]]);
  for (const entry of components) {
    const id = snapshot.componentCatalogs[entry[0]] ?? snapshot.catalogId;
    groups.set(id, [...(groups.get(id) ?? []), entry]);
  }
  return [...groups].filter(([, group]) => group.length > 0);
}

export function functionHandlerProblem(handlers: number): string | undefined {
  if (handlers === 1) return undefined;
  if (handlers === 0) {
    return "No useGenerativeUIFunction handler is mounted, so the model does not get this function.";
  }
  return `${handlers} handlers are mounted. Mount exactly one, or the model does not get this function.`;
}
