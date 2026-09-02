import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { serializeDisplayValue } from "../../shared/display/display-value.js";
import { PortableLitElement } from "../portable-lit-element.js";
import { defineInspectorCopyButton } from "../copy-button/copy-button.js";
import { tokenizeJson } from "./json-tokenizer.js";
import { jsonViewerStyles } from "./json-viewer.styles.js";

export const INSPECTOR_JSON_VIEWER_TAG = "cpk-inspector-json-viewer" as const;

export type JsonViewerMode = "block" | "inline";

type DisplayPresentation = Readonly<{
  serialized: string;
  tokens: ReturnType<typeof tokenizeJson>;
}>;

const presentationCache = new WeakMap<object, DisplayPresentation>();

function createPresentation(value: unknown): DisplayPresentation {
  const serialized = serializeDisplayValue(value, { pretty: true });
  return { serialized, tokens: tokenizeJson(serialized) };
}

function presentationFor(value: unknown): DisplayPresentation {
  if (typeof value !== "object" || value === null) {
    return createPresentation(value);
  }
  const cached = presentationCache.get(value);
  if (cached) return cached;
  const presentation = createPresentation(value);
  presentationCache.set(value, presentation);
  return presentation;
}

export class InspectorJsonViewerElement extends PortableLitElement {
  static properties = {
    value: { attribute: false },
    mode: { type: String, reflect: true },
    copyable: { type: Boolean, reflect: true },
    copyLabel: { type: String, attribute: "copy-label" },
    maxHeight: { type: String, attribute: "max-height" },
    clipboard: { attribute: false },
  };

  static styles = jsonViewerStyles;

  value: unknown = null;
  mode: JsonViewerMode = "block";
  copyable = false;
  copyLabel = "Copy";
  maxHeight = "";
  clipboard: Pick<Clipboard, "writeText"> | undefined;

  override connectedCallback(): void {
    defineInspectorCopyButton(this.ownerDocument.defaultView?.customElements);
    super.connectedCallback();
  }

  private renderTokens(presentation: DisplayPresentation) {
    return presentation.tokens.map((token) =>
      token.type === "plain"
        ? token.text
        : html`<span class=${`token token--${token.type}`}>${token.text}</span>`,
    );
  }

  protected override render() {
    const presentation = presentationFor(this.value);
    const content = this.renderTokens(presentation);
    const style = styleMap({ maxHeight: this.maxHeight || undefined });

    return html`
      <div class=${this.copyable ? "frame frame--copyable" : "frame"}>
        ${
          this.mode === "inline"
            ? html`<code class="inline" style=${style}>${content}</code>`
            : html`<pre style=${style}><code>${content}</code></pre>`
        }
        ${
          this.copyable
            ? html`<cpk-inspector-copy-button
              .value=${presentation.serialized}
              .label=${this.copyLabel}
              .clipboard=${this.clipboard}
            ></cpk-inspector-copy-button>`
            : nothing
        }
      </div>
    `;
  }
}

export function defineInspectorJsonViewer(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  defineInspectorCopyButton(registry);
  if (!registry?.get(INSPECTOR_JSON_VIEWER_TAG)) {
    registry?.define(INSPECTOR_JSON_VIEWER_TAG, InspectorJsonViewerElement);
  }
}
