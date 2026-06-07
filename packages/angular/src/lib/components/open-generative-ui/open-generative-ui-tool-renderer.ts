import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import type { AngularToolCall, ToolRenderer } from "../../tools";
import type { GenerateSandboxedUiArgs } from "../../open-generative-ui";

@Component({
  selector: "copilot-open-generative-ui-tool-renderer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibleMessage(); as message) {
      <div
        data-testid="open-generative-ui-tool-placeholder"
        class="copilot-open-generative-ui-placeholder"
      >
        {{ message }}
      </div>
    }
  `,
  styles: [
    `
      .copilot-open-generative-ui-placeholder {
        padding: 8px 12px;
        color: #999;
        font-size: 14px;
      }
    `,
  ],
})
export class CopilotOpenGenerativeUIToolRenderer implements ToolRenderer<GenerateSandboxedUiArgs> {
  readonly toolCall =
    input.required<AngularToolCall<GenerateSandboxedUiArgs>>();

  private readonly visibleMessageIndex = signal(0);
  private readonly destroyRef = inject(DestroyRef);
  private previousMessageCount = 0;
  private interval: ReturnType<typeof setInterval> | undefined;

  protected readonly visibleMessage = computed(() => {
    const call = this.toolCall();
    if (call.status === "complete") return undefined;

    const messages = call.args.placeholderMessages;
    if (!messages?.length) return undefined;

    return messages[this.visibleMessageIndex()] ?? messages[0];
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());

    effect((onCleanup) => {
      const call = this.toolCall();
      const messages = call.args.placeholderMessages;
      this.clearTimer();

      if (!messages?.length) {
        this.previousMessageCount = 0;
        this.visibleMessageIndex.set(0);
        return;
      }

      if (messages.length !== this.previousMessageCount) {
        this.previousMessageCount = messages.length;
        this.visibleMessageIndex.set(messages.length - 1);
      }

      if (call.status === "complete") return;

      this.interval = setInterval(() => {
        this.visibleMessageIndex.update(
          (index) => (index + 1) % messages.length,
        );
      }, 5000);

      onCleanup(() => this.clearTimer());
    });
  }

  private clearTimer(): void {
    if (this.interval === undefined) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }
}
