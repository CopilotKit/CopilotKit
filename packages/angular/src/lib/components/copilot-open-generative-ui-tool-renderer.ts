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
import type { AngularToolCall } from "../tools";
import type { GenerateSandboxedUiArgs } from "../sandbox-functions";

const CYCLE_INTERVAL_MS = 5000;

/**
 * Tool renderer for the auto-registered `generateSandboxedUi` frontend tool.
 *
 * While the tool is in-progress or executing, cycles through the LLM-supplied
 * `placeholderMessages` every {@link CYCLE_INTERVAL_MS}. When a new message
 * arrives mid-stream, jumps directly to it (the latest message wins). Renders
 * nothing once the tool completes — the activity renderer takes over the UI.
 *
 * Mirrors React's `OpenGenerativeUIToolRenderer`.
 */
@Component({
  selector: "copilot-open-generative-ui-tool-renderer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibleMessage(); as message) {
      <div
        style="padding: 8px 12px; color: #999; font-size: 14px"
        data-slot="open-generative-ui-tool-renderer"
      >
        {{ message }}
      </div>
    }
  `,
})
export class CopilotOpenGenerativeUIToolRenderer {
  readonly toolCall =
    input.required<AngularToolCall<GenerateSandboxedUiArgs>>();

  private readonly call = computed(() => this.toolCall());
  private readonly messages = computed(
    () => this.call().args.placeholderMessages ?? [],
  );
  private readonly status = computed(() => this.call().status);
  private readonly visibleIndex = signal(0);
  private prevMessageCount = 0;
  private cycleHandle: ReturnType<typeof setInterval> | null = null;

  readonly visibleMessage = computed(() => {
    if (this.status() === "complete") return null;
    const list = this.messages();
    if (list.length === 0) return null;
    return list[this.visibleIndex()] ?? list[0] ?? null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(
      () => {
        const list = this.messages();
        const status = this.status();

        if (list.length !== this.prevMessageCount) {
          this.prevMessageCount = list.length;
          if (list.length > 0) {
            this.visibleIndex.set(list.length - 1);
          } else {
            this.visibleIndex.set(0);
          }
        }

        this.stopCycle();
        if (list.length > 0 && status !== "complete") {
          this.cycleHandle = setInterval(() => {
            this.visibleIndex.update((i) => (i + 1) % list.length);
          }, CYCLE_INTERVAL_MS);
        }
      },
      { allowSignalWrites: true },
    );

    destroyRef.onDestroy(() => this.stopCycle());
  }

  private stopCycle(): void {
    if (this.cycleHandle !== null) {
      clearInterval(this.cycleHandle);
      this.cycleHandle = null;
    }
  }
}
