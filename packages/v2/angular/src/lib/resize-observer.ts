import { Injectable, ElementRef, NgZone, OnDestroy } from "@angular/core";
import { Observable, Subject, BehaviorSubject } from "rxjs";
import { debounceTime, takeUntil, distinctUntilChanged } from "rxjs/operators";

export interface ResizeState {
  width: number;
  height: number;
  isResizing: boolean;
}

@Injectable({
  providedIn: "root",
})
export class ResizeObserverService implements OnDestroy {
  private destroy$ = new Subject<void>();
  private observers = new Map<HTMLElement, ResizeObserver>();
  private resizeStates = new Map<HTMLElement, BehaviorSubject<ResizeState>>();
  private resizeTimeouts = new Map<HTMLElement, number>();

  constructor(private ngZone: NgZone) {}

  /**
   * Observe element resize with debouncing and resizing state
   * @param element Element to observe
   * @param debounceMs Debounce time (default 250ms)
   * @param resizingDurationMs How long to show "isResizing" state (default 250ms)
   */
  observeElement(
    element: ElementRef<HTMLElement> | HTMLElement,
    debounceMs: number = 0,
    resizingDurationMs: number = 250
  ): Observable<ResizeState> {
    const el = element instanceof ElementRef ? element.nativeElement : element;

    // Return existing observer if already observing
    if (this.resizeStates.has(el)) {
      return this.resizeStates.get(el)!.asObservable();
    }

    // Create new subject for this element
    const resizeState$ = new BehaviorSubject<ResizeState>({
      width: el.offsetWidth,
      height: el.offsetHeight,
      isResizing: false,
    });

    this.resizeStates.set(el, resizeState$);

    // Create ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0) return;

      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;

      this.ngZone.run(() => {
        // Clear existing timeout
        const existingTimeout = this.resizeTimeouts.get(el);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        // Update state with isResizing = true
        resizeState$.next({
          width,
          height,
          isResizing: true,
        });

        // Set timeout to clear isResizing flag
        if (resizingDurationMs > 0) {
          const timeout = window.setTimeout(() => {
            resizeState$.next({
              width,
              height,
              isResizing: false,
            });
            this.resizeTimeouts.delete(el);
          }, resizingDurationMs);

          this.resizeTimeouts.set(el, timeout);
        } else {
          // If no duration, immediately set isResizing to false
          resizeState$.next({
            width,
            height,
            isResizing: false,
          });
        }
      });
    });

    // Start observing
    resizeObserver.observe(el);
    this.observers.set(el, resizeObserver);

    // Return observable with debouncing if specified
    const observable = resizeState$.asObservable().pipe(
      debounceMs > 0 ? debounceTime(debounceMs) : (source) => source,
      distinctUntilChanged(
        (a, b) =>
          a.width === b.width &&
          a.height === b.height &&
          a.isResizing === b.isResizing
      ),
      takeUntil(this.destroy$)
    );

    return observable;
  }

  /**
   * Stop observing an element
   * @param element Element to stop observing
   */
  unobserve(element: ElementRef<HTMLElement> | HTMLElement): void {
    const el = element instanceof ElementRef ? element.nativeElement : element;

    // Clear timeout if exists
    const timeout = this.resizeTimeouts.get(el);
    if (timeout) {
      clearTimeout(timeout);
      this.resizeTimeouts.delete(el);
    }

    // Disconnect observer
    const observer = this.observers.get(el);
    if (observer) {
      observer.disconnect();
      this.observers.delete(el);
    }

    // Complete and remove subject
    const subject = this.resizeStates.get(el);
    if (subject) {
      subject.complete();
      this.resizeStates.delete(el);
    }
  }

  /**
   * Get current size of element
   * @param element Element to measure
   */
  getCurrentSize(element: ElementRef<HTMLElement> | HTMLElement): {
    width: number;
    height: number;
  } {
    const el = element instanceof ElementRef ? element.nativeElement : element;
    return {
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
  }

  /**
   * Get current resize state of element
   * @param element Element to check
   */
  getCurrentState(
    element: ElementRef<HTMLElement> | HTMLElement
  ): ResizeState | null {
    const el = element instanceof ElementRef ? element.nativeElement : element;
    const subject = this.resizeStates.get(el);
    return subject ? subject.value : null;
  }

  ngOnDestroy(): void {
    // Clear all timeouts
    this.resizeTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.resizeTimeouts.clear();

    // Disconnect all observers
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();

    // Complete all subjects
    this.resizeStates.forEach((subject) => subject.complete());
    this.resizeStates.clear();

    // Complete destroy subject
    this.destroy$.next();
    this.destroy$.complete();
  }
}
