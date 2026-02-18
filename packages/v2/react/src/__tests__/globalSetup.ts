/**
 * Runs once in Node before test workers start.
 * Ensures `window` exists on globalThis so any code that runs during module
 * resolution (e.g. when Vitest discovers tests) does not throw "window is not defined".
 * CI can load test files in the main process before jsdom is available in workers.
 */
export default function globalSetup() {
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as any).window === "undefined"
  ) {
    (globalThis as any).window = globalThis as any;
  }
}
