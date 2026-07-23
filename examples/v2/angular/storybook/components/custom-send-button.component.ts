import { Component, EventEmitter, Input, Output } from "@angular/core";
import { CommonModule } from "@angular/common";

@Component({
  selector: "custom-send-button",
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [disabled]="disabled"
      (click)="handleClick()"
      class="cpk:rounded-full cpk:w-10 cpk:h-10 cpk:bg-blue-500 cpk:text-white cpk:hover:bg-blue-600 cpk:transition-colors cpk:mr-2 cpk:disabled:opacity-50 cpk:disabled:cursor-not-allowed"
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
