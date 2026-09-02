/** Runs an asynchronous operation with an abort signal and timeout. */
export async function withAbortTimeout<Result>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}
