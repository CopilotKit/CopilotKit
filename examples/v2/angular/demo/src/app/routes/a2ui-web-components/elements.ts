import type { A2UIProps } from "@copilotkit/angular/a2ui";
import { A2uiElement } from "./a2ui-element";
import { definitions } from "./definitions";

type Props<K extends keyof typeof definitions> = A2UIProps<
  typeof definitions,
  K
>;

/** Stars the user clicks; the choice is written to the bound data path. */
export class RatingElement extends A2uiElement<Props<"Rating">> {
  protected readonly schema = definitions.Rating.props;

  protected render(props: Props<"Rating">): void {
    const value = props.value ?? 0;
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        :host { display: inline-flex; gap: 4px; margin: 8px; }
        button { padding: 0; border: 0; background: none; font-size: 28px;
          line-height: 1; color: #d4d4d8; cursor: pointer; }
        button.on { color: #f59e0b; }
      </style>
      ${[1, 2, 3, 4, 5]
        .map(
          (star) =>
            `<button type="button" data-star="${star}" aria-label="${star} stars"
              class="${star <= value ? "on" : ""}">★</button>`,
        )
        .join("")}
    `;
    root
      .querySelectorAll("button")
      .forEach((button) =>
        button.addEventListener("click", () =>
          props.setValue?.(Number(button.dataset["star"])),
        ),
      );
  }
}

/** A read-only half-circle gauge for a bound value. */
export class GaugeElement extends A2uiElement<Props<"Gauge">> {
  protected readonly schema = definitions.Gauge.props;

  protected render(props: Props<"Gauge">): void {
    const value = props.value ?? 0;
    const max = props.max ?? 100;
    const ratio = Math.max(0, Math.min(1, value / (max || 1)));
    const angle = Math.PI * (1 - ratio);
    const x = 60 + 50 * Math.cos(angle);
    const y = 60 - 50 * Math.sin(angle);
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        :host { display: block; margin: 8px; text-align: center;
          font: 12px system-ui, sans-serif; color: #52525b; }
        .value { font-size: 22px; font-weight: 700; fill: #18181b; }
      </style>
      <svg viewBox="0 0 120 70" width="180" role="img">
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e4e4e7"
          stroke-width="10" stroke-linecap="round" />
        <path d="M10 60 A50 50 0 0 1 ${x} ${y}" fill="none" stroke="#16a34a"
          stroke-width="10" stroke-linecap="round" />
        <text class="value" x="60" y="58" text-anchor="middle">${value}</text>
      </svg>
      <div class="label"></div>
    `;
    // The label comes from the agent, so it is set as text, never as HTML.
    root.querySelector("svg")!.setAttribute("aria-label", props.label);
    root.querySelector(".label")!.textContent = props.label;
  }
}
