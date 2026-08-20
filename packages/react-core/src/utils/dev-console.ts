/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — shouldShowDevConsole:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;

  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "0.0.0.0"
  );
}

export function shouldShowDevConsole(showDevConsole?: boolean): boolean {
  // If explicitly set, use that value
  if (showDevConsole !== undefined) {
    return showDevConsole;
  }

  // If not set, default to true on localhost
  return isLocalhost();
}
