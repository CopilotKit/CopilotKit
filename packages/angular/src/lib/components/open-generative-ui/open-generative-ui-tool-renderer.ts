import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  inject,
  input,
  signal,
} from "@angular/core";
import { ɵPlaceholderCycler } from "@copilotkit/core";
import type { AngularToolCall, ToolRenderer } from "../../tools";
import type { GenerateSandboxedUiArgs } from "../../open-generative-ui";
import { explicitEffect } from "../../explicit-effect";

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

  readonly #cycler = new ɵPlaceholderCycler();
  protected readonly visibleMessage = signal(
    this.#cycler.getSnapshot().message,
  );

  constructor() {
    const zone = inject(NgZone);
    const unsubscribe = this.#cycler.subscribe(() =>
      zone.run(() =>
        this.visibleMessage.set(this.#cycler.getSnapshot().message),
      ),
    );
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.#cycler.dispose();
    });
    explicitEffect(this.toolCall, (call) =>
      this.#cycler.update(
        call.args.placeholderMessages,
        call.status === "complete",
      ),
    );
  }
}
