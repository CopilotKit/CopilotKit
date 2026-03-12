import { Root } from '@a2ui/web-lib/ui';
import { html, css } from 'lit';
import { property } from 'lit/decorators.js';

export class PremiumTextField extends Root {
  @property() accessor label = '';
  @property() accessor text = '';

  static styles = [
    ...Root.styles,
    css`
      :host {
        display: block;
        padding: 16px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        border: 1px solid #e0e0e0;
        transition: all 0.2s ease;
        font-family: 'Inter', sans-serif;
      }
      :host(:hover) {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.12);
      }
      .input-container {
        position: relative;
        margin-top: 8px;
      }
      input {
        width: 100%;
        padding: 12px 16px;
        font-size: 16px;
        border: 2px solid #e0e0e0;
        border-radius: 8px;
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
        background: #fafafa;
      }
      input:focus {
        border-color: #6200ee;
        background: #fff;
      }
      label {
        display: block;
        font-size: 14px;
        font-weight: 600;
        color: #333;
        margin-bottom: 4px;
      }
      .hint {
        margin-top: 8px;
        font-size: 12px;
        color: #666;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .badge {
        background: #6200ee;
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: bold;
        text-transform: uppercase;
      }
    `
  ];

  render() {
    return html`
      <label>${this.label}</label>
      <div class="input-container">
        <input type="text" .value="${this.text}" placeholder="Type here...">
      </div>
      <div class="hint">
        <span class="badge">Custom</span>
        <span>This is a premium override of the standard TextField.</span>
      </div>
    `;
  }
}
