import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";
import { copyToClipboard } from "@copilotkit/shared";
import { CopilotIcon, Copy, Check } from "../icons/copilot-icon";
import { injectChatLabels } from "../../chat-config";

/**
 * Language label and copy button above a rendered markdown code block.
 * Mounted by CopilotChatAssistantMessageRenderer into the sanitized markdown
 * DOM; styled by that component.
 */
@Component({
  selector: "copilot-chat-code-block-header",
  imports: [CopilotIcon],
  host: { class: "code-block-header" },
  template: `
    <span [class.code-block-language]="language()">{{ language() }}</span>
    <button
      type="button"
      class="code-block-copy-button"
      [attr.aria-label]="label() + ' code'"
      (click)="copy()"
    >
      <copilot-icon [img]="copied() ? CheckIcon : CopyIcon" [size]="10" />
      <span>{{ label() }}</span>
    </button>
  `,
})
export class CopilotChatCodeBlockHeader {
  readonly language = input("");
  readonly code = input.required<string>();

  protected readonly CopyIcon = Copy;
  protected readonly CheckIcon = Check;
  protected readonly copied = signal(false);
  private readonly labels = injectChatLabels();
  protected readonly label = computed(() =>
    this.copied()
      ? this.labels.assistantMessageToolbarCopyCodeCopiedLabel
      : this.labels.assistantMessageToolbarCopyCodeLabel,
  );

  private resetTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.resetTimer));
  }

  protected copy(): void {
    copyToClipboard(this.code()).then((success) => {
      if (!success) return;
      this.copied.set(true);
      clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
