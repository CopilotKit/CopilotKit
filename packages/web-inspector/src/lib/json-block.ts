import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

// ─── JSON syntax highlighter ─────────────────────────────────────────────────
// Inline-styled so shadow DOM encapsulation preserves colors when the output
// is injected via unsafeHTML. Only for structured data — never raw user HTML.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Memoize highlight output by payload reference. Tab switches cause Lit to
// re-render the active panel from scratch, and the JSON.stringify + regex
// pass below is by far the most expensive thing in the events / state
// panels (potentially MB of agent state). Caching by object reference
// turns subsequent renders of an unchanged event list into near-zero JS work.
const highlightedJsonCache = new WeakMap<object, string>();

function highlightedJson(obj: unknown): string {
  if (typeof obj === "object" && obj !== null) {
    const cached = highlightedJsonCache.get(obj);
    if (cached !== undefined) return cached;
  }
  const json = JSON.stringify(obj, null, 2);
  if (!json) return "";
  const parts: string[] = [];
  let lastIndex = 0;
  const re =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(json)) !== null) {
    parts.push(escapeHtml(json.slice(lastIndex, match.index)));
    const m = match[0];
    let token = "num";
    if (m.startsWith('"')) {
      token = m.trimEnd().endsWith(":") ? "key" : "str";
    } else if (m === "true" || m === "false") {
      token = "bool";
    } else if (m === "null") {
      token = "nil";
    }
    parts.push(
      `<span class="cpk-json-token cpk-json-token--${token}">${escapeHtml(m)}</span>`,
    );
    lastIndex = match.index + m.length;
  }
  parts.push(escapeHtml(json.slice(lastIndex)));
  const result = parts.join("");
  if (typeof obj === "object" && obj !== null) {
    highlightedJsonCache.set(obj, result);
  }
  return result;
}

export function coerceJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }

  const looksJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksJson) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * Draws one JSON value of the inspector into a container that the host page
 * owns. `value` is the raw value: a JSON string or an already-parsed value.
 * Return a function to run when the inspector removes or replaces the value.
 */
export type InspectorJsonRenderer = (
  container: HTMLElement,
  value: unknown,
) => (() => void) | void;

let inspectorJsonRenderer: InspectorJsonRenderer | null = null;
let inspectorJsonSlotCount = 0;

export const JSON_BLOCK_TAG = "cpk-json-block";

/**
 * Replaces the inspector's built-in JSON blocks (tool arguments and results,
 * state, events, and context) with a host renderer. Pass `null` to restore the
 * built-in blocks. Set it before the inspector renders: a block that is
 * already on screen changes at the inspector's next render.
 *
 * @example
 * ```ts
 * setInspectorJsonRenderer((container, value) => {
 *   const root = createRoot(container);
 *   root.render(<JsonView value={value} />);
 *   return () => root.unmount();
 * });
 * ```
 */
export function setInspectorJsonRenderer(
  renderer: InspectorJsonRenderer | null,
): void {
  inspectorJsonRenderer = renderer;
}

/**
 * Hosts one value drawn by the host renderer. Inside a shadow root, the
 * container lives in the shadow host's light DOM and shows here through a
 * named slot, so the host page's own styles apply to what the renderer draws.
 */
// The fallback keeps module import safe where no DOM exists (server render).
export class CpkJsonBlock extends ((globalThis.HTMLElement ??
  class {}) as typeof HTMLElement) {
  #value: unknown = undefined;
  #hasValue = false;
  #cleanup: (() => void) | undefined;
  #container: HTMLElement | undefined;

  get value(): unknown {
    return this.#value;
  }

  set value(next: unknown) {
    if (this.#hasValue && Object.is(next, this.#value)) return;
    this.#value = next;
    this.#hasValue = true;
    if (this.isConnected) this.#render();
  }

  connectedCallback(): void {
    this.style.display = "block";
    this.#render();
  }

  disconnectedCallback(): void {
    this.#teardown();
  }

  #render(): void {
    this.#teardown();
    const renderer = inspectorJsonRenderer;
    if (!renderer) return;
    const root = this.getRootNode();
    const container = this.ownerDocument.createElement("div");
    // `instanceof ShadowRoot` fails across realms (the pop-out window).
    if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && "host" in root) {
      inspectorJsonSlotCount += 1;
      const name = `cpk-json-${inspectorJsonSlotCount}`;
      const slot = this.ownerDocument.createElement("slot");
      slot.name = name;
      this.replaceChildren(slot);
      container.slot = name;
      (root as ShadowRoot).host.append(container);
    } else {
      this.replaceChildren(container);
    }
    this.#container = container;
    const cleanup = renderer(container, this.#value);
    this.#cleanup = typeof cleanup === "function" ? cleanup : undefined;
  }

  #teardown(): void {
    const cleanup = this.#cleanup;
    this.#cleanup = undefined;
    cleanup?.();
    this.#container?.remove();
    this.#container = undefined;
    this.replaceChildren();
  }
}

export function renderHighlightedJsonBlock(
  value: unknown,
  options: { maxHeight?: string } = {},
) {
  if (inspectorJsonRenderer) {
    // The raw value keeps its identity across renders, so an unchanged
    // value does not draw again.
    return html`<cpk-json-block
      .value=${value}
      style=${
        options.maxHeight
          ? `overflow:auto;max-height:${options.maxHeight}`
          : nothing
      }
    ></cpk-json-block>`;
  }
  const parsed = coerceJsonValue(value);
  const style = options.maxHeight
    ? `max-height:${options.maxHeight}`
    : undefined;
  return html`<pre class="cpk-json-block" style=${style || nothing}>
${unsafeHTML(highlightedJson(parsed))}</pre
  >`;
}
