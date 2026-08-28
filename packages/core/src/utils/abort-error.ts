const ABORT_MESSAGES: ReadonlySet<string> = new Set([
  "Fetch is aborted",
  "signal is aborted without reason",
  "component unmounted",
]);

export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "AbortError") {
    return true;
  }
  return typeof message === "string" && ABORT_MESSAGES.has(message);
}
