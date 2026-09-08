import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from "@angular/core";
import { toObservable, toSignal } from "@angular/core/rxjs-interop";
import { EMPTY } from "rxjs";
import { switchMap } from "rxjs/operators";
import { ResizeObserverService } from "../../resize-observer";

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
 * dynamically created content is in the DOM (and never during SSR), and the
 * ResizeObserver keeps the height current from there, including the initial
 * 0 → laid-out transition.
 */
@Directive({
  selector: "[copilotChatViewInputMeasure]",
})
export class CopilotChatViewInputMeasure {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly resizeObserverService = inject(ResizeObserverService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Root element of the input container component — its absolutely
   * positioned overlay wrapper — once it has been rendered into the slot.
   * Custom input containers without that element are left unmeasured.
   */
  private readonly target = signal<HTMLElement | null>(null);

  private readonly state = toSignal(
    toObservable(this.target).pipe(
      switchMap((el) =>
        el
          ? this.resizeObserverService.observeElement(new ElementRef(el))
          : EMPTY,
      ),
    ),
  );

  /** Measured height of the input container in px; 0 until first laid out. */
  readonly height = computed(() => this.state()?.height ?? 0);

  /** True while the input container is resizing, false once it has settled. */
  readonly resizing = computed(() => this.state()?.isResizing ?? false);

  constructor() {
    afterNextRender(() => {
      const el = this.host.nativeElement.querySelector(
        "copilot-chat-view-input-container",
      )?.firstElementChild;
      if (el instanceof HTMLElement) {
        this.destroyRef.onDestroy(() =>
          this.resizeObserverService.unobserve(el),
        );
        this.target.set(el);
      }
    });
  }
}
