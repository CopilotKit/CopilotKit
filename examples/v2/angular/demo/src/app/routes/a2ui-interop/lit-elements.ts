import { LitElement, css, html, svg } from "lit";

/**
 * Plain Lit web components, standing in for an existing design system. They
 * know nothing about A2UI or Angular: they take properties, render slotted
 * content, and emit DOM events.
 */

class DemoLitPanel extends LitElement {
  static properties = {
    heading: { type: String },
    tone: { type: String, reflect: true },
  };

  heading = "";
  tone: "info" | "success" | "warning" = "info";

  static styles = css`
    :host {
      display: block;
      flex: 1;
      min-width: 0;
      margin: 8px;
      border-radius: 12px;
      border: 1px solid var(--tone);
      background: color-mix(in srgb, var(--tone) 6%, white);
      --tone: #2563eb;
    }
    :host([tone="success"]) {
      --tone: #16a34a;
    }
    :host([tone="warning"]) {
      --tone: #d97706;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid color-mix(in srgb, var(--tone) 30%, white);
      font:
        600 13px/1.2 system-ui,
        sans-serif;
      color: var(--tone);
    }
    header::before {
      content: "LIT";
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--tone);
      color: white;
      font-size: 10px;
      letter-spacing: 0.05em;
    }
    .body {
      padding: 8px;
    }
  `;

  render() {
    return html`
      <header>${this.heading}</header>
      <div class="body"><slot></slot></div>
    `;
  }
}

class DemoLitRating extends LitElement {
  static properties = {
    value: { type: Number },
    max: { type: Number },
  };

  value = 0;
  max = 5;

  static styles = css`
    :host {
      display: inline-flex;
      gap: 4px;
      margin: 8px;
    }
    button {
      padding: 0;
      border: none;
      background: none;
      font-size: 28px;
      line-height: 1;
      color: #d4d4d8;
      cursor: pointer;
    }
    button.on {
      color: #f59e0b;
    }
  `;

  private select(value: number): void {
    this.dispatchEvent(
      new CustomEvent("rating-change", { detail: value, bubbles: true }),
    );
  }

  render() {
    return Array.from(
      { length: this.max },
      (_, index) => html`
        <button
          type="button"
          class=${index < this.value ? "on" : ""}
          aria-label=${`${index + 1} stars`}
          @click=${() => this.select(index + 1)}
        >
          ★
        </button>
      `,
    );
  }
}

class DemoLitGauge extends LitElement {
  static properties = {
    value: { type: Number },
    max: { type: Number },
    label: { type: String },
  };

  value = 0;
  max = 100;
  label = "";

  static styles = css`
    :host {
      display: block;
      margin: 8px;
      text-align: center;
      font:
        12px system-ui,
        sans-serif;
      color: #52525b;
    }
    .value {
      font-size: 22px;
      font-weight: 700;
      fill: #18181b;
    }
  `;

  render() {
    const ratio = Math.max(0, Math.min(1, this.value / (this.max || 1)));
    const angle = Math.PI * (1 - ratio);
    const x = 60 + 50 * Math.cos(angle);
    const y = 60 - 50 * Math.sin(angle);
    return html`
      <svg viewBox="0 0 120 70" width="180" role="img" aria-label=${this.label}>
        ${svg`
          <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e4e4e7" stroke-width="10" stroke-linecap="round" />
          <path d="M10 60 A50 50 0 0 1 ${x} ${y}" fill="none" stroke="#16a34a" stroke-width="10" stroke-linecap="round" />
          <text class="value" x="60" y="58" text-anchor="middle">${this.value}</text>
        `}
      </svg>
      <div>${this.label}</div>
    `;
  }
}

/** Defines the elements once; safe to call from several components. */
export function defineDemoLitElements(): void {
  for (const [tag, element] of [
    ["demo-lit-panel", DemoLitPanel],
    ["demo-lit-rating", DemoLitRating],
    ["demo-lit-gauge", DemoLitGauge],
  ] as const) {
    if (!customElements.get(tag)) customElements.define(tag, element);
  }
}
