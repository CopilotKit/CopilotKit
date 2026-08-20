/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useDefaultTool:
 *   V2 import and usage:
 *     import { useDefaultRenderTool } from "@copilotkit/react-core/v2";
 *     useDefaultRenderTool({});
 *   V2 replacement source: packages/react-core/src/v2/hooks/use-default-render-tool.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useDefaultRenderTool
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-core/src/hooks/use-default-tool.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { useCopilotAction } from "./use-copilot-action";
import type { CatchAllFrontendAction } from "../types/frontend-action";

export function useDefaultTool(
  tool: Omit<CatchAllFrontendAction, "name">,
  dependencies?: any[],
) {
  // Use the existing useCopilotAction hook
  useCopilotAction(
    { ...tool, name: "*" } satisfies CatchAllFrontendAction,
    dependencies,
  );
}
