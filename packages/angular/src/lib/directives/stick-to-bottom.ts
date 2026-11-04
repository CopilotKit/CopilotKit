import {
  Directive,
  ElementRef,
  OnDestroy,
  AfterViewInit,
  PLATFORM_ID,
  inject,
  input,
  output,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  ɵSCROLL_BOTTOM_THRESHOLD_PX,
  ɵcreateStickToBottom,
  ɵisScrolledToBottom,
} from "@copilotkit/core";
import type { ɵStickToBottom } from "@copilotkit/core";
import { explicitEffect } from "../explicit-effect";

export type ScrollBehavior = "smooth" | "instant" | "auto";

/**
 * Keeps a scroll container at its bottom while content arrives, and stops
 * when the reader scrolls up. Scrolling back to the bottom, or a call to
 * `scrollToBottom()`, starts it again. Core's `ɵStickToBottom` does the work.
 *
 * The content is the descendant with `data-stick-to-bottom-content`, or the
 * first child element.
 *
 * @example
 * ```html
 * <div copilotStickToBottom
 *      [enabled]="true"
 *      [threshold]="12"
 *      [initialBehavior]="'smooth'"
 *      [resizeBehavior]="'smooth'"
 *      (isAtBottomChange)="onBottomChange($event)">
 *   <!-- Content -->
 * </div>
 * ```
 */
@Directive({
  standalone: true,
  selector: "[copilotStickToBottom]",
})
export class StickToBottom implements AfterViewInit, OnDestroy {
  /** `false` only tracks the position and does not follow new content. */
  enabled = input<boolean>(true);
  /** Pixels from the end that still count as the bottom. Default: 12. */
  threshold = input<number>(ɵSCROLL_BOTTOM_THRESHOLD_PX);
  initialBehavior = input<ScrollBehavior>("smooth");
  resizeBehavior = input<ScrollBehavior>("smooth");
  /** Wait this many ms before `isAtBottomChange` reports a change. */
  debounceMs = input<number>(100);

  isAtBottomChange = output<boolean>();
  scrollToBottomRequested = output();

  private elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private platformId = inject(PLATFORM_ID);
  private controller?: ɵStickToBottom;
  private emitTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    explicitEffect(this.enabled, (enabled) =>
      this.controller?.setFollow(enabled),
    );
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const element = this.elementRef.nativeElement;
    const content =
      element.querySelector<HTMLElement>("[data-stick-to-bottom-content]") ??
      (element.firstElementChild instanceof HTMLElement
        ? element.firstElementChild
        : element);

    // The first value goes out once below, so the controller's own first
    // report during creation is skipped.
    let created = false;
    this.controller = ɵcreateStickToBottom({
      scrollElement: element,
      contentElement: content,
      threshold: this.threshold(),
      follow: this.enabled(),
      initialBehavior: this.initialBehavior(),
      followBehavior: this.resizeBehavior(),
      onChange: (isAtBottom) => {
        if (created) this.emitIsAtBottom(isAtBottom);
      },
    });
    created = true;
    // A recreated directive (autoScroll off and on) starts from the real
    // position, not the parent's last value.
    this.emitIsAtBottom(this.controller.isAtBottom);
  }

  /**
   * Public method to scroll to bottom
   * Can be called from parent component
   */
  public scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
    if (this.controller) {
      this.controller.scrollToBottom(behavior);
    } else {
      const element = this.elementRef.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
    this.scrollToBottomRequested.emit();
  }

  /**
   * Check if currently at bottom
   */
  public isAtBottom(): boolean {
    return ɵisScrolledToBottom(this.elementRef.nativeElement, this.threshold());
  }

  /**
   * Get current scroll state
   */
  public getScrollState() {
    const element = this.elementRef.nativeElement;
    return {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      isAtBottom: this.isAtBottom(),
    };
  }

  ngOnDestroy(): void {
    this.controller?.dispose();
    this.controller = undefined;
    clearTimeout(this.emitTimer);
  }

  private emitIsAtBottom(isAtBottom: boolean): void {
    clearTimeout(this.emitTimer);
    const delay = this.debounceMs();
    if (delay <= 0) {
      this.isAtBottomChange.emit(isAtBottom);
      return;
    }
    this.emitTimer = setTimeout(
      () => this.isAtBottomChange.emit(isAtBottom),
      delay,
    );
  }
}
