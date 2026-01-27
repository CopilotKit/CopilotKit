import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { injectChatState } from "@copilotkitnext/angular";

@Component({
  selector: "nextgen-custom-input",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <form
      class="ck-input-wrapper"
      (ngSubmit)="submit()"
      [class.ck-disabled]="inProgress"
      novalidate
      autocomplete="off"
    >
      <button
        type="button"
        class="ck-icon"
        [disabled]="inProgress"
        title="Add attachment"
      >
        ＋
      </button>

      <label for="ck-message" class="sr-only">Message</label>
      <input
        id="ck-message"
        name="message"
        class="ck-input"
        type="text"
        [(ngModel)]="value"
        (ngModelChange)="chatState.changeInput($event)"
        [disabled]="inProgress"
        placeholder="Ask anything…"
        autocapitalize="sentences"
        autocomplete="off"
        spellcheck="true"
        maxlength="4000"
        (keydown)="onKeyDown($event)"
        (compositionstart)="composing = true"
        (compositionend)="composing = false"
      />

      <button
        type="submit"
        class="ck-send"
        [disabled]="inProgress || !canSend"
        [attr.aria-label]="'Send message'"
      >
        ↑
      </button>
    </form>
  `,
  styles: [
    `
      .ck-input-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #fff;
        border-radius: 16px;
        padding: 10px 12px;
        margin: 8px;
        border: 1px solid #eee;
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
      }
      .ck-input-wrapper.ck-disabled {
        opacity: 0.7;
        pointer-events: none;
      }
      .ck-icon {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 1px solid #ddd;
        background: #fff;
        display: grid;
        place-items: center;
        cursor: pointer;
      }
      .ck-input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        font-size: 14px;
        color: #333;
        padding: 8px 4px;
      }
      .ck-input::placeholder {
        color: #a0a0a0;
      }
      .ck-send {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        display: grid;
        place-items: center;
        background: #000;
        color: #fff;
        cursor: pointer;
        font-size: 16px;
      }
      .sr-only {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomChatInputComponent {
  @Input() inProgress = false;
  @Input() inputClass?: string;

  value = "";
  composing = false;

  readonly chatState = injectChatState();

  get valueTrimmed(): string {
    return this.value.trim();
  }
  get canSend(): boolean {
    return this.valueTrimmed.length > 0;
  }

  async submit(): Promise<void> {
    if (this.inProgress) return;
    if (!this.canSend) return;
    this.chatState.submitInput(this.valueTrimmed);
    this.value = "";
  }

  onKeyDown(e: KeyboardEvent): void {
    if (this.composing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.submit();
    }
  }
}
