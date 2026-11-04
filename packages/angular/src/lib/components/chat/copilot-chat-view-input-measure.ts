import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  signal,
} from "@angular/core";
import { ɵwatchElementHeight } from "@copilotkit/core";

/**
 * Measures the chat view's floating input container and exposes its height
 * as a signal.
 *
 * Applied to the copilot-slot hosting the input container. Because the slot
 * only exists on the chat-view branch of the template (the welcome-screen
 * branch omits it), the directive's lifecycle mirrors the overlay's: it is
 * created when the overlay mounts — including after the user sends their
 * first message from the welcome screen — and torn down with it.
 *
 * Measurement is platform-driven: afterNextRender fires once the slot's
 * dynamically created content is in the DOM (and never during SSR), and
 * core's `ɵwatchElementHeight` keeps the height current from there,
 * including the initial 0 → laid-out transition.
 */
@Directive({
  selector: "[copilotChatViewInputMeasure]",
})
export class CopilotChatViewInputMeasure {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Measured height of the input container in px; 0 until first laid out. */
  readonly height = signal(0);

  /** True while the input container is resizing, false once it has settled. */
  readonly resizing = signal(false);

  constructor() {
    afterNextRender(() => {
      // Root element of the input container component (its absolutely
      // positioned overlay wrapper). Custom input containers without that
      // element are left unmeasured.
      const el = this.host.nativeElement.querySelector(
        "copilot-chat-view-input-container",
      )?.firstElementChild;
      if (!(el instanceof HTMLElement)) return;
      const stop = ɵwatchElementHeight(el, ({ height, isResizing }) => {
        this.height.set(height);
        this.resizing.set(isResizing);
      });
      this.destroyRef.onDestroy(stop);
    });
  }
}
