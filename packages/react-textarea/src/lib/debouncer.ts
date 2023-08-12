export type AsyncFunction<T extends any[]> = (
  ...args: [...T, AbortSignal]
) => Promise<void>;

export class Debouncer<T extends any[]> {
  private timeoutId?: number;
  private activeAbortController?: AbortController;

  constructor(private func: AsyncFunction<T>, private wait: number) {}

  debounce = async (...args: T) => {
    // Abort the previous promise immediately
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = undefined;
    }

    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(async () => {
      try {
        this.activeAbortController = new AbortController();

        // Pass the signal to the async function, assuming it supports it
        await this.func(...args, this.activeAbortController.signal);

        this.activeAbortController = undefined;
      } catch (error) {}
    }, this.wait);
  };
}
