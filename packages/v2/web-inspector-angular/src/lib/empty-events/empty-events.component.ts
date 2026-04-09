import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  input,
} from "@angular/core";
import { CommonModule } from "@angular/common";

@Component({
  selector: "cpk-empty-events",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <div class="cpk-ee">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="cpk-ee__icon"
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
      <span class="cpk-ee__title">{{ label() }}</span>
      <span *ngIf="hint()" class="cpk-ee__hint">{{ hint() }}</span>
    </div>
  `,
  styles: [
    `
      @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap");

      :host {
        display: flex;
        flex: 1;
        min-height: 0;
      }

      .cpk-ee {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 40px 16px;
        font-family: "Plus Jakarta Sans", sans-serif;
        color: #838389;
      }

      .cpk-ee__icon {
        color: #afafb7;
      }

      .cpk-ee__title {
        font-size: 13px;
        font-weight: 500;
        color: #838389;
      }

      .cpk-ee__hint {
        font-size: 11px;
        color: #afafb7;
        text-align: center;
        max-width: 220px;
        line-height: 1.5;
      }
    `,
  ],
})
export class EmptyEventsComponent {
  label = input.required<string>();
  hint = input<string | null>(null);
}
