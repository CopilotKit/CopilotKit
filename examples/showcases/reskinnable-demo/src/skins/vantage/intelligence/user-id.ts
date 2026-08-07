// SERVER-SAFE MODULE — keep it that way. This is reached through the
// server-only agent registry (src/shell/agent-registry.ts), which the API
// route imports directly, so pulling in a client module here would drag React
// components into the API route's server bundle. Concretely: no `"use client"`
// at the top of this file, no JSX, and no relative imports of client (.tsx)
// modules — only plain .ts modules.
import type { IdentifyRunUser } from "@/shell/agent-registry";

/**
 * Scope Intelligence threads (and, from phase 2, durable memory) to the acting
 * exec. Phase 1 always resolves the CFO; the client forwards `{ userRole, userId }`
 * through CopilotKitProvider's `properties`, which arrive here as the run body's
 * forwardedProps.
 */
export const vantageIdentifyUser: IdentifyRunUser = (properties) => ({
  id: properties?.userId ?? "exec-cfo",
  name: properties?.userRole ?? "CFO",
});
