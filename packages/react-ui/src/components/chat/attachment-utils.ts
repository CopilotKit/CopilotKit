// Re-export utilities from shared
export {
  getModalityFromMimeType,
  formatFileSize,
  exceedsMaxSize,
  readFileAsBase64,
  generateVideoThumbnail,
  matchesAcceptFilter,
} from "@copilotkit/shared";

// Deprecation warning helpers — react-ui specific
const suppressedWarnings = new Set<string>();
let globalSuppress = false;

/**
 * Issue a deprecation warning once per key per session.
 * Suppressed entirely if the user calls suppressDeprecationWarnings().
 */
export function deprecationWarning(key: string, message: string) {
  if (globalSuppress || suppressedWarnings.has(key)) return;
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production")
    return;
  suppressedWarnings.add(key);
  console.warn(`[CopilotKit] Deprecation: ${message}`);
}

/**
 * Suppress all CopilotKit deprecation warnings.
 */
export function suppressDeprecationWarnings() {
  globalSuppress = true;
}
