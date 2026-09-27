import {
  Component,
  EventEmitter,
  Input,
  Output,
  ChangeDetectionStrategy,
} from "@angular/core";

@Component({
  selector: "custom-send-button",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <button
      type="button"
      class="story-send-button"
      aria-label="Send message"
      [disabled]="disabled"
      (click)="handleClick()"
    >
      <span aria-hidden="true">✈</span> Send
    </button>
  `,
})
export class CustomSendButtonComponent {
  @Input() disabled = false;
  @Output() clicked = new EventEmitter<void>();

  handleClick(): void {
    if (!this.disabled) {
      this.clicked.emit();
    }
  }
}
