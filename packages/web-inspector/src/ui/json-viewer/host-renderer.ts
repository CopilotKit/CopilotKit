import { html, nothing } from "lit";
import type { TemplateResult } from "lit";

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

export const INSPECTOR_JSON_BLOCK_TAG = "cpk-json-block" as const;

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
 * Renders a raw value through the host renderer, or returns null when no host
 * renderer is set so the caller keeps its built-in block.
 */
export function renderHostJsonBlock(
  value: unknown,
  options: { maxHeight?: string } = {},
): TemplateResult | null {
  if (!inspectorJsonRenderer) return null;
  // The raw value keeps its identity across renders, so an unchanged value
  // does not draw again.
  return html`<cpk-json-block
    .value=${value}
    style=${
      options.maxHeight
        ? `overflow:auto;max-height:${options.maxHeight}`
        : nothing
    }
  ></cpk-json-block>`;
}

/**
 * Hosts one value drawn by the host renderer. Inside a shadow root, the
 * container lives in the shadow host's light DOM and shows here through a
 * named slot, so the host page's own styles apply to what the renderer draws.
 */
// The fallback keeps module import safe where no DOM exists (server render).
export class InspectorJsonBlockElement extends ((globalThis.HTMLElement ??
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
