import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatState } from '@copilotkitnext/angular';

@Component({
  selector: 'custom-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div [class]="inputClass" style="
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      padding: 20px;
      border-radius: 15px;
      margin: 10px;
    ">
      <input 
        type="text"
        [(ngModel)]="inputValue"
        placeholder="💬 Ask me anything..."
        style="
          width: 100%;
          padding: 15px;
          border: 2px solid white;
          border-radius: 10px;
          font-size: 16px;
          background: rgba(255, 255, 255, 0.9);
          color: #333;
          outline: none;
        "
        (keyup.enter)="handleSend()"
      />
      <button 
        style="
          margin-top: 10px;
          padding: 10px 20px;
          background: white;
          color: #f5576c;
          border: none;
          border-radius: 5px;
          font-weight: bold;
          cursor: pointer;
        "
        (click)="handleSend()">
        Send Message ✨
      </button>
    </div>
  `
})
export class CustomInputComponent {
  @Input() inputClass?: string;
  
  inputValue = '';
  
  constructor(private chat: ChatState) {}
  
  handleSend() {
    const value = this.inputValue.trim();
    if (value) {
      this.chat.submitInput(value);
      this.inputValue = '';
    }
  }
}
