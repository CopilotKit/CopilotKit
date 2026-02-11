import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'custom-send-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [disabled]="disabled"
      (click)="handleClick()"
      class="rounded-full w-10 h-10 bg-blue-500 text-white hover:bg-blue-600 transition-colors mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      ✈️
    </button>
  `
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