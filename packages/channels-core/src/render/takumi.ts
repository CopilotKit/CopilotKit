import { render } from "takumi-js";
import { createElement, cloneElement, Fragment as ReactFragment } from "react";
import type { ReactElement } from "react";
import type { ResolvedRenderConfig } from "./config.js";

// The converter builds elements from dynamically-typed nodes, so React's strict
// `createElement` overloads don't apply — use a loose alias.
const h = createElement as (
  type: unknown,
  props: unknown,
  ...children: unknown[]
) => unknown;

// React tags elements with one of these symbols (pre-19 vs 19+).
const REACT_ELEMENT = Symbol.for("react.element");
const REACT_TRANSITIONAL = Symbol.for("react.transitional.element");

function isReactEl(
  v: unknown,
): v is { type: unknown; props: Record<string, unknown>; key?: unknown } {
  if (typeof v !== "object" || v === null || !("$$typeof" in v)) return false;
  const t = (v as { $$typeof: unknown }).$$typeof;
  return t === REACT_ELEMENT || t === REACT_TRANSITIONAL;
}

interface Node {
  type: string | ((p: Record<string, unknown>) => unknown) | symbol;
  props: Record<string, unknown>;
  key?: string | number;
}
function isNode(v: unknown): v is Node {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    "props" in v &&
    !("$$typeof" in v)
  );
}

function toChildren(children: unknown): unknown[] {
  if (children == null || children === false) return [];
  return (Array.isArray(children) ? children : [children]).map(toReact);
}

/**
 * Materialize a channels JSX tree to real React elements for Takumi.
 *
 * Under the channels JSX runtime, host tags (`<div>`) are already React
 * elements while component tags (`<BarChart>`, `<Meter>`, your card) are
 * `ChannelNode`s — so a host card is a React element whose children may contain
 * component nodes. This walk (only reached on the image path, where react is
 * present):
 *  - React element → rebuilt with its children converted (so a component node
 *    nested inside a host card is materialized);
 *  - component `ChannelNode` → INVOKED, its output converted;
 *  - Fragment → React fragment; primitives pass through.
 */
function toReact(node: unknown): unknown {
  if (node == null || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return node.map(toReact);
  if (isReactEl(node)) {
    const { children, ...rest } = node.props ?? {};
    const key = node.key;
    return h(
      node.type,
      key != null ? { ...rest, key } : rest,
      ...toChildren(children),
    );
  }
  if (isNode(node)) {
    const { type, props, key } = node;
    if (typeof type === "function") {
      // Unbranded app component / chart: invoke it and convert what it renders.
      // Carry the node's key onto the result so mapped component nodes
      // (`items.map(i => <Meter key={i.id}/>)`) don't warn about missing keys.
      const out = toReact(type(props ?? {}));
      return key != null && isReactEl(out)
        ? cloneElement(out as ReactElement, { key })
        : out;
    }
    const { children, ...rest } = props ?? {};
    if (typeof type === "symbol") {
      // Fragment (channels' sentinel) → React fragment.
      return h(
        ReactFragment,
        key != null ? { key } : null,
        ...toChildren(children),
      );
    }
    // A string-typed node shouldn't reach the image path (host tags are React
    // elements); render defensively as a host tag.
    return h(
      type,
      key != null ? { ...rest, key } : rest,
      ...toChildren(children),
    );
  }
  return null;
}

/**
 * Render a channels JSX tree (or a React element) to a PNG with Takumi. `node`
 * has been classified as image content by `resolveArbitraryElement` (./detect).
 * We materialize it to React elements first (see {@link toReact}).
 */
export async function renderJsxToPng(
  node: unknown,
  cfg: ResolvedRenderConfig,
): Promise<Uint8Array> {
  if ((cfg.fonts?.length ?? 0) === 0) {
    // Takumi ships only a Latin fallback; warn once so non-Latin text doesn't silently drop.
    warnNoFonts();
  }
  const png = await render(toReact(node) as never, {
    width: cfg.width,
    height: cfg.height,
    fonts: cfg.fonts as never,
    stylesheets: cfg.stylesheets,
  });
  return png as Uint8Array;
}

let warned = false;
function warnNoFonts(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[channel] render: no fonts configured — only Latin (Geist) glyphs will render. " +
      "Pass render.fonts on createChannel for your app font / non-Latin text.",
  );
}
