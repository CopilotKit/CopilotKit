/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — suppressDeprecationWarnings:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-ui/src/components/chat/attachment-utils.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
