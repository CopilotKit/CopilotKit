/**
 * Coalesces live transcript refreshes. Streaming chunks can arrive faster than
 * a transcript can load, so the inspector keeps one pending refresh instead of
 * aborting and replacing every request: a browser abort need not cancel work
 * already on the server. A refresh starts at most once per interval and never
 * while another request is in flight, and the last update is never dropped.
 */
export class MessageRefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private lastFetchAt = 0;

  constructor(private readonly intervalMs: number) {}

  /** Marks that the transcript changed since the last request started. */
  request(): void {
    this.pending = true;
  }

  /** Records that a request started; it covers every update so far. */
  started(): void {
    this.cancelTimer();
    this.pending = false;
    this.lastFetchAt = Date.now();
  }

  /** Forgets every pending refresh, for example when the thread changes. */
  reset(): void {
    this.cancelTimer();
    this.pending = false;
    this.lastFetchAt = 0;
  }

  /**
   * Runs the pending refresh after the rest of the interval. `canRun` is
   * checked now and again when the timer fires.
   */
  schedule(canRun: () => boolean, run: () => void): void {
    if (!this.pending || this.timer !== null || !canRun()) return;
    const delay = Math.max(
      0,
      this.intervalMs - (Date.now() - this.lastFetchAt),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      if (canRun()) run();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
