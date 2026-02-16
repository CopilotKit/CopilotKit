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
      class="mr-2 h-10 w-10 rounded-full bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
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
