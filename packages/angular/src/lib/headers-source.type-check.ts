/**
 * Compile-only check (#1937): `CopilotKitConfig.headers` accepts an async
 * builder. This lives in a plain `.ts` file (not `.spec.ts`) on purpose —
 * `tsconfig.json` excludes `**\/*.spec.ts`/`**\/*.test.ts` from the compile
 * `check-types` runs, so the same assertion placed inside a spec file would
 * silently stop protecting anything if the config type ever regressed to
 * `Record<string, string>`. Never imported anywhere; its only job is to fail
 * `tsc --noEmit` if this stops compiling.
 */
import type { CopilotKitConfig } from "./config";

export const ɵheadersAsyncBuilderCompiles: CopilotKitConfig = {
  headers: async () => ({}),
};
