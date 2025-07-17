/**
 * Utility functions for error handling
 */

/**
 * Checks if an error is an abort error from debounced autosuggestion requests
 * that should be suppressed rather than logged
 */
export function isAbortError(error: any): boolean {
  const message = error?.message || "";
  return (
    message.includes("BodyStreamBuffer was aborted") ||
    message.includes("signal is aborted without reason")
  );
}
