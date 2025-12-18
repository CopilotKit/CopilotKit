import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'custom-scroll-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button 
      type="button"
      (click)="handleClick()"
      [class]="inputClass"
      [class.hover]="isHovered"
      (mouseenter)="isHovered = true"
      (mouseleave)="isHovered = false"
      style="
        position: fixed;
        bottom: 100px;
        right: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: 3px solid white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s;
        z-index: 1000;
      "
      [style.transform]="isHovered ? 'scale(1.1)' : 'scale(1)'">
      <span style="color: white; font-size: 24px; pointer-events: none;">⬇️</span>
    </button>
  `,
  styles: [`
    button.hover {
      transform: scale(1.1);
    }
  `]
})
export class CustomScrollButtonComponent {
  @Input() onClick?: () => void;
  @Input() inputClass?: string;
  @Output() clicked = new EventEmitter<void>();
  
  isHovered = false;
  
  handleClick() {
    // Emit the clicked event for the slot system to handle
    this.clicked.emit();
    // Also call onClick if provided for backward compatibility
    if (this.onClick) {
      this.onClick();
    }
  }
}
