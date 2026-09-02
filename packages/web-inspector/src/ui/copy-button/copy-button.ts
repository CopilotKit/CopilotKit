import { html, nothing } from "lit";
import { PortableLitElement } from "../portable-lit-element.js";
import { copyButtonStyles } from "./copy-button.styles.js";

export const INSPECTOR_COPY_BUTTON_TAG = "cpk-inspector-copy-button" as const;

type CopyState = "idle" | "copied" | "error";
type ClipboardWriter = Pick<Clipboard, "writeText">;
export type CopyButtonVariant = "text" | "icon";

export class InspectorCopyButtonElement extends PortableLitElement {
  static properties = {
    value: { type: String },
    label: { type: String },
    copiedLabel: { type: String, attribute: "copied-label" },
    errorLabel: { type: String, attribute: "error-label" },
    clipboard: { attribute: false },
    resetDelayMs: { type: Number, attribute: "reset-delay-ms" },
    variant: { type: String, reflect: true },
    accessibleLabel: { type: String, attribute: "accessible-label" },
    state: { state: true },
  };

  static styles = copyButtonStyles;

  value = "";
  label = "Copy";
  copiedLabel = "Copied";
  errorLabel = "Copy failed";
  clipboard: ClipboardWriter | undefined;
  resetDelayMs = 2_000;
  variant: CopyButtonVariant = "text";
  accessibleLabel = "";
  private state: CopyState = "idle";
  private resetTimer: number | undefined;
  private resetTimerWindow: Window | undefined;
  private copySequence = 0;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.copySequence += 1;
    this.clearResetTimer();
    this.state = "idle";
  }

  private clearResetTimer(): void {
    if (this.resetTimer === undefined) return;
    this.resetTimerWindow?.clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    this.resetTimerWindow = undefined;
  }

  private copy = async (): Promise<void> => {
    const sequence = ++this.copySequence;
    const clipboard =
      this.clipboard ?? this.ownerDocument.defaultView?.navigator.clipboard;
    if (!clipboard?.writeText) {
      this.state = "error";
      return;
    }

    try {
      await clipboard.writeText(this.value);
      if (sequence !== this.copySequence || !this.isConnected) return;
      this.state = "copied";
      this.clearResetTimer();
      this.resetTimerWindow =
        this.ownerDocument.defaultView ?? globalThis.window;
      this.resetTimer = this.resetTimerWindow?.setTimeout(() => {
        this.resetTimer = undefined;
        this.resetTimerWindow = undefined;
        this.state = "idle";
      }, this.resetDelayMs);
    } catch {
      if (sequence === this.copySequence && this.isConnected) {
        this.state = "error";
      }
    }
  };

  protected override render() {
    const visibleLabel =
      this.state === "copied" ? this.copiedLabel : this.label;
    const accessibleName = this.accessibleLabel
      ? this.state === "copied"
        ? `${this.copiedLabel}: ${this.accessibleLabel}`
        : this.accessibleLabel
      : this.variant === "icon"
        ? visibleLabel
        : nothing;
    const status =
      this.state === "copied"
        ? this.copiedLabel
        : this.state === "error"
          ? this.errorLabel
          : "";

    return html`
      <button
        type="button"
        part="button"
        class=${this.variant}
        data-state=${this.state}
        aria-label=${accessibleName}
        @click=${(event: Event) => {
          event.stopPropagation();
          void this.copy();
        }}
      >
        ${
          this.variant === "icon"
            ? this.state === "copied"
              ? html`
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="m20 6-11 11-5-5"></path>
                  </svg>
                `
              : html`
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect width="14" height="14" x="8" y="8" rx="2"></rect>
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                  </svg>
                `
            : visibleLabel
        }
      </button>
      <span class="status" role="status" aria-atomic="true">${status}</span>
    `;
  }
}

export function defineInspectorCopyButton(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (!registry?.get(INSPECTOR_COPY_BUTTON_TAG)) {
    registry?.define(INSPECTOR_COPY_BUTTON_TAG, InspectorCopyButtonElement);
  }
}
