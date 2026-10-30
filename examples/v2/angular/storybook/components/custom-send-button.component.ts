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
      [disabled]="disabled"
      (click)="handleClick()"
      class="story-send-button story-send-button-blue"
    >
      ✈️
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
