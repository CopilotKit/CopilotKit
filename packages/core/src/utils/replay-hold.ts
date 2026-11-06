import { Observable } from "rxjs";

/**
 * Holds a thread's replayed events and hands them on in one synchronous burst.
 *
 * The Intelligence gateway sends a replay one websocket frame per event, and
 * the browser runs each frame as its own task. Events passed on as they arrive
 * are therefore applied, and re-rendered, one at a time: a long thread took
 * minutes to load. Held until the gateway reports the replay complete and then
 * released together, they reach AG-UI as one burst, which it applies as a
 * single update.
 *
 * While holding, values from the wrapped stream are kept; `release()` passes
 * them on in arrival order, synchronously, and later values go straight
 * through until `hold()` is called again (a new replay after a rejoin). When
 * the wrapped stream completes or errors, what is held is released first, so
 * nothing is lost. `discard()` drops what is held instead, for history that
 * will be sent again.
 */
export class ReplayHold<T> {
  private held: T[] | undefined;
  private deliver: ((value: T) => void) | undefined;

  constructor(holding: boolean) {
    this.held = holding ? [] : undefined;
  }

  /** Start holding values, if not already. */
  hold(): void {
    this.held ??= [];
  }

  /** Pass on everything held, in order, and stop holding. */
  release(): void {
    const held = this.held;
    this.held = undefined;
    if (!held || !this.deliver) return;
    for (const value of held) this.deliver(value);
  }

  /**
   * Drop everything held and stop holding. Nothing held has been passed on,
   * so a consumer whose replay cursor follows what it passed on asks for it
   * again.
   */
  discard(): void {
    this.held = undefined;
  }

  /** `source$`, held or passed through as this hold says. One subscriber at a time. */
  through(source$: Observable<T>): Observable<T> {
    return new Observable<T>((subscriber) => {
      this.deliver = (value) => subscriber.next(value);
      const subscription = source$.subscribe({
        next: (value) => {
          if (this.held) this.held.push(value);
          else subscriber.next(value);
        },
        error: (error: unknown) => {
          this.release();
          subscriber.error(error);
        },
        complete: () => {
          this.release();
          subscriber.complete();
        },
      });
      return () => {
        subscription.unsubscribe();
        this.deliver = undefined;
      };
    });
  }
}
