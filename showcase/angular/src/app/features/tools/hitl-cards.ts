import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from "@angular/core";
import type { HumanInTheLoopToolCall } from "@copilotkit/angular";

@Component({
  selector: "showcase-time-picker-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="showcase-tool-card" data-testid="time-picker-card">
      <span>Choose a time</span>
      @if (picked()) {
        <p data-testid="time-picker-picked">Booked {{ picked() }}</p>
      } @else {
        <div class="time-picker-options">
          @for (slot of slots; track slot.value) {
            <button
              type="button"
              data-testid="time-picker-slot"
              (click)="choose(slot.value, slot.label)"
            >
              {{ slot.label }}
            </button>
          }
        </div>
      }
    </article>
  `,
})
export class TimePickerCard {
  readonly toolCall = input.required<HumanInTheLoopToolCall>();
  protected readonly picked = signal<string | null>(null);
  protected readonly slots = [
    { value: "09:00", label: "9:00 AM" },
    { value: "11:30", label: "11:30 AM" },
    { value: "14:00", label: "2:00 PM" },
  ] as const;

  protected choose(value: string, label: string): void {
    this.picked.set(label);
    this.toolCall().respond({ chosen_time: value, chosen_label: label });
  }
}

@Component({
  selector: "showcase-approval-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="approval-dialog-overlay" data-testid="approval-dialog-overlay">
      <section
        class="approval-dialog"
        data-testid="approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
      >
        <span>Human approval</span>
        <h2 id="approval-title">Approve this action?</h2>
        <p>{{ summary() }}</p>
        <div>
          <button
            type="button"
            data-testid="approval-dialog-reject"
            (click)="respond(false)"
          >
            Reject
          </button>
          <button
            type="button"
            data-testid="approval-dialog-approve"
            (click)="respond(true)"
          >
            Approve
          </button>
        </div>
      </section>
    </div>
  `,
})
export class ApprovalDialog {
  readonly toolCall = input.required<HumanInTheLoopToolCall>();

  protected summary(): string {
    const args = this.toolCall().args;
    return Object.entries(args)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(" · ");
  }

  protected respond(approved: boolean): void {
    this.toolCall().respond({ approved });
  }
}
