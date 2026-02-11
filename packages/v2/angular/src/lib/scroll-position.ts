import { Injectable, ElementRef, NgZone, OnDestroy } from "@angular/core";
import { ScrollDispatcher, ViewportRuler } from "@angular/cdk/scrolling";
import {
  Observable,
  Subject,
  BehaviorSubject,
  fromEvent,
  merge,
  animationFrameScheduler,
} from "rxjs";
import {
  takeUntil,
  debounceTime,
  throttleTime,
  distinctUntilChanged,
  map,
  startWith,
} from "rxjs/operators";

export interface ScrollState {
  isAtBottom: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

@Injectable({
  providedIn: "root",
})
export class ScrollPosition implements OnDestroy {
  private destroy$ = new Subject<void>();
  private scrollStateSubject = new BehaviorSubject<ScrollState>({
    isAtBottom: true,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });

  public scrollState$ = this.scrollStateSubject.asObservable();

  constructor(
    private scrollDispatcher: ScrollDispatcher,
    private viewportRuler: ViewportRuler,
    private ngZone: NgZone
  ) {}

  /**
   * Monitor scroll position of an element
   * @param element The element to monitor
   * @param threshold Pixels from bottom to consider "at bottom" (default 10)
   */
  monitorScrollPosition(
    element: ElementRef<HTMLElement> | HTMLElement,
    threshold: number = 10
  ): Observable<ScrollState> {
    const el = element instanceof ElementRef ? element.nativeElement : element;

    // Create scroll observable
    const scroll$ = merge(
      fromEvent(el, "scroll"),
      this.viewportRuler.change(150) // Monitor viewport changes
    ).pipe(
      startWith(null), // Emit initial state
      throttleTime(16, animationFrameScheduler, { trailing: true }), // ~60fps
      map(() => this.getScrollState(el, threshold)),
      distinctUntilChanged(
        (a, b) =>
          a.isAtBottom === b.isAtBottom &&
          a.scrollTop === b.scrollTop &&
          a.scrollHeight === b.scrollHeight
      ),
      takeUntil(this.destroy$)
    );

    // Subscribe and update subject
    scroll$.subscribe((state) => {
      this.scrollStateSubject.next(state);
    });

    return scroll$;
  }

  /**
   * Scroll element to bottom with smooth animation
   * @param element The element to scroll
   * @param smooth Whether to use smooth scrolling
   */
  scrollToBottom(
    element: ElementRef<HTMLElement> | HTMLElement,
    smooth: boolean = true
  ): void {
    const el = element instanceof ElementRef ? element.nativeElement : element;

    this.ngZone.runOutsideAngular(() => {
      if (smooth && "scrollBehavior" in document.documentElement.style) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: "smooth",
        });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  /**
   * Check if element is at bottom
   * @param element The element to check
   * @param threshold Pixels from bottom to consider "at bottom"
   */
  isAtBottom(
    element: ElementRef<HTMLElement> | HTMLElement,
    threshold: number = 10
  ): boolean {
    const el = element instanceof ElementRef ? element.nativeElement : element;
    return this.getScrollState(el, threshold).isAtBottom;
  }

  /**
   * Get current scroll state of element
   */
  public getScrollState(element: HTMLElement, threshold: number): ScrollState {
    const scrollTop = element.scrollTop;
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAtBottom = distanceFromBottom <= threshold;

    return {
      isAtBottom,
      scrollTop,
      scrollHeight,
      clientHeight,
    };
  }

  /**
   * Create a ResizeObserver for element size changes
   * @param element The element to observe
   * @param debounceMs Debounce time in milliseconds
   */
  observeResize(
    element: ElementRef<HTMLElement> | HTMLElement,
    debounceMs: number = 250
  ): Observable<ResizeObserverEntry> {
    const el = element instanceof ElementRef ? element.nativeElement : element;
    const resize$ = new Subject<ResizeObserverEntry>();

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        this.ngZone.run(() => {
          resize$.next(entry);
        });
      }
    });

    resizeObserver.observe(el);

    // Cleanup on destroy
    this.destroy$.subscribe(() => {
      resizeObserver.disconnect();
    });

    return resize$.pipe(debounceTime(debounceMs), takeUntil(this.destroy$));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.scrollStateSubject.complete();
  }
}
