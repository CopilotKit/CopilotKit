/** How long each placeholder message shows before the next one. */
export const PLACEHOLDER_CYCLE_MS = 5000;

export interface PlaceholderCyclerSnapshot {
  /** The message to show, or undefined when there is none to show. */
  message: string | undefined;
}

/**
 * Rotates the placeholder messages of a `generateSandboxedUi` tool call.
 *
 * When a new message streams in, it shows at once; while the call is not
 * complete the messages then rotate every 5 s. A new snapshot with the same
 * number of messages keeps the rotation running, so streaming arguments do
 * not restart it. Once the call is complete nothing shows: the activity
 * renderer owns the UI.
 *
 * @example
 * ```ts
 * const cycler = new ɵPlaceholderCycler();
 * cycler.subscribe(() => render(cycler.getSnapshot().message));
 * cycler.update(args.placeholderMessages, status === "complete");
 * // on unmount:
 * cycler.dispose();
 * ```
 */
export class PlaceholderCycler {
  readonly #listeners = new Set<() => void>();
  #messages: readonly string[] = [];
  #complete = false;
  #index = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #snapshot: PlaceholderCyclerSnapshot = { message: undefined };

  /** The current snapshot. The same object until the message changes. */
  getSnapshot = () => this.#snapshot;

  /** Calls `listener` when the message changes. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Sets the latest messages and whether the tool call is complete.
   *
   * @param messages - The streamed `placeholderMessages`, if any.
   * @param complete - Whether the tool call has finished.
   */
  update(messages: readonly string[] | undefined, complete: boolean) {
    const next = messages ?? [];
    const countChanged = next.length !== this.#messages.length;
    const completeChanged = complete !== this.#complete;
    this.#messages = next;
    this.#complete = complete;
    if (countChanged) this.#index = Math.max(next.length - 1, 0);

    const shouldRun = !complete && next.length > 0;
    if (!shouldRun) this.#stop();
    else if (countChanged || completeChanged || !this.#timer) this.#start();
    this.#emit();
  }

  /** Stops the rotation. A later `update()` starts it again. */
  dispose() {
    this.#stop();
  }

  #start() {
    this.#stop();
    this.#timer = setInterval(() => {
      this.#index = (this.#index + 1) % Math.max(this.#messages.length, 1);
      this.#emit();
    }, PLACEHOLDER_CYCLE_MS);
  }

  #stop() {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #emit() {
    const message = this.#complete
      ? undefined
      : (this.#messages[this.#index] ?? this.#messages[0]);
    if (message === this.#snapshot.message) return;
    this.#snapshot = { message };
    for (const listener of this.#listeners) listener();
  }
}
