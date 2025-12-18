import {
  Directive,
  ElementRef,
  OnInit,
  OnDestroy,
  AfterViewInit,
  inject,
  input,
  output,
} from "@angular/core";
import { ScrollPosition } from "../scroll-position";
import { ResizeObserverService } from "../resize-observer";
import { Subject } from "rxjs";
import {
  takeUntil,
  debounceTime,
  filter,
  distinctUntilChanged,
} from "rxjs/operators";

export type ScrollBehavior = "smooth" | "instant" | "auto";

/**
 * Directive for implementing stick-to-bottom scroll behavior
 * Similar to the React use-stick-to-bottom library
 *
 * @example
 * ```html
 * <div copilotStickToBottom
 *      [enabled]="true"
 *      [threshold]="10"
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
  providers: [ScrollPosition, ResizeObserverService],
})
export class StickToBottom implements OnInit, AfterViewInit, OnDestroy {
  enabled = input<boolean>(true);
  threshold = input<number>(10);
  initialBehavior = input<ScrollBehavior>("smooth");
  resizeBehavior = input<ScrollBehavior>("smooth");
  debounceMs = input<number>(100);

  isAtBottomChange = output<boolean>();
  scrollToBottomRequested = output<void>();

  private elementRef = inject(ElementRef);
  private scrollService = inject(ScrollPosition);
  private resizeService = inject(ResizeObserverService);

  private destroy$ = new Subject<void>();
  private contentElement?: HTMLElement;
  private wasAtBottom = true;
  private hasInitialized = false;
  private userHasScrolled = false;

  ngOnInit(): void {
    // Setup will happen in ngAfterViewInit
  }

  ngAfterViewInit(): void {
    const element = this.elementRef.nativeElement as HTMLElement;

    // Find or create content wrapper
    this.contentElement = element.querySelector(
      "[data-stick-to-bottom-content]"
    ) as HTMLElement;
    if (!this.contentElement) {
      this.contentElement = element;
    }

    this.setupScrollMonitoring();
    this.setupResizeMonitoring();
    this.setupContentMutationObserver();

    // Initial scroll to bottom if enabled
    setTimeout(() => {
      this.hasInitialized = true;
      if (this.enabled()) {
        this.scrollToBottom(this.initialBehavior());
      }
    }, 0);
  }

  private setupScrollMonitoring(): void {
    if (!this.enabled()) return;

    const element = this.elementRef.nativeElement;

    // Monitor scroll position
    this.scrollService
      .monitorScrollPosition(element, this.threshold())
      .pipe(
        takeUntil(this.destroy$),
        debounceTime(this.debounceMs()),
        distinctUntilChanged((a, b) => a.isAtBottom === b.isAtBottom)
      )
      .subscribe((state) => {
        const wasAtBottom = this.wasAtBottom;
        this.wasAtBottom = state.isAtBottom;

        // Detect user scroll
        if (!state.isAtBottom && wasAtBottom && this.hasInitialized) {
          this.userHasScrolled = true;
        } else if (state.isAtBottom) {
          this.userHasScrolled = false;
        }

        // Emit change
        this.isAtBottomChange.emit(state.isAtBottom);
      });
  }

  private setupResizeMonitoring(): void {
    if (!this.enabled() || !this.contentElement) return;

    // Monitor content resize
    this.resizeService
      .observeElement(this.contentElement, 0, 250)
      .pipe(
        takeUntil(this.destroy$),
        filter(() => this.enabled() && !this.userHasScrolled)
      )
      .subscribe((state) => {
        // Auto-scroll on resize if we were at bottom
        if (this.wasAtBottom && !state.isResizing) {
          this.scrollToBottom(this.resizeBehavior());
        }
      });

    // Monitor container resize
    const element = this.elementRef.nativeElement;
    this.resizeService
      .observeElement(element, 0, 250)
      .pipe(
        takeUntil(this.destroy$),
        filter(
          () => this.enabled() && !this.userHasScrolled && this.wasAtBottom
        )
      )
      .subscribe(() => {
        // Adjust scroll on container resize
        this.scrollToBottom(this.resizeBehavior());
      });
  }

  private setupContentMutationObserver(): void {
    if (!this.enabled() || !this.contentElement) return;

    const mutationObserver = new MutationObserver(() => {
      if (this.enabled() && this.wasAtBottom && !this.userHasScrolled) {
        // Content changed, scroll to bottom if we were there
        requestAnimationFrame(() => {
          this.scrollToBottom(this.resizeBehavior());
        });
      }
    });

    mutationObserver.observe(this.contentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Cleanup on destroy
    this.destroy$.subscribe(() => {
      mutationObserver.disconnect();
    });
  }

  /**
   * Public method to scroll to bottom
   * Can be called from parent component
   */
  public scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
    const element = this.elementRef.nativeElement;
    const smooth = behavior === "smooth";

    this.scrollService.scrollToBottom(element, smooth);
    this.userHasScrolled = false;
    this.scrollToBottomRequested.emit();
  }

  /**
   * Check if currently at bottom
   */
  public isAtBottom(): boolean {
    return this.scrollService.isAtBottom(
      this.elementRef.nativeElement,
      this.threshold()
    );
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
    this.destroy$.next();
    this.destroy$.complete();
  }
}
