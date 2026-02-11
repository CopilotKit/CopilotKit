export type AsyncFunction<T extends any[]> = (...args: [...T, AbortSignal]) => Promise<void>;

export class Debouncer<T extends any[]> {
  private timeoutId?: ReturnType<typeof setTimeout>;
  private activeAbortController?: AbortController;

  constructor(private wait: number) {}

  debounce = async (func: AsyncFunction<T>, ...args: T) => {
    // Abort the previous promise immediately
    this.cancel();

    this.timeoutId = setTimeout(async () => {
      try {
        this.activeAbortController = new AbortController();

        // Pass the signal to the async function, assuming it supports it
        await func(...args, this.activeAbortController.signal);

        this.activeAbortController = undefined;
      } catch (error) {}
    }, this.wait);
  };

  cancel = () => {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = undefined;
    }

    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  };
}
