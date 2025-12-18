import { Component, Input } from '@angular/core';

@Component({
  selector: 'custom-disclaimer',
  standalone: true,
  template: `
    <div [class]="inputClass" style="
      text-align: center;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 10px;
      margin: 10px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    ">
      <h3 style="margin: 0 0 10px 0; font-size: 20px;">
        ✨ Custom Disclaimer Component ✨
      </h3>
      <p style="margin: 0; font-size: 14px; opacity: 0.9;">
        {{ text || 'This is a custom disclaimer demonstrating component overrides!' }}
      </p>
      <div style="
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid rgba(255, 255, 255, 0.3);
        font-size: 12px;
        opacity: 0.7;
      ">
        🎨 Styled with custom gradients and animations
      </div>
    </div>
  `
})
export class CustomDisclaimerComponent {
  @Input() text?: string;
  @Input() inputClass?: string;
}
