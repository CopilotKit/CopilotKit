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
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { useCopilotAction } from "./use-copilot-action";
import { CatchAllFrontendAction } from "../types/frontend-action";

/**
 * Distributes `Omit` across a union so each member keeps its own shape. A plain
 * `Omit<A | B, K>` collapses to the properties common to both, which would lose
 * the render / renderAndWaitForResponse exclusivity of
 * {@link CatchAllFrontendAction}.
 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown
  ? Omit<T, K>
  : never;

export function useDefaultTool(
  tool: DistributiveOmit<CatchAllFrontendAction, "name">,
  dependencies?: any[],
) {
  // Use the existing useCopilotAction hook. The cast is needed because
  // spreading a union produces a single object type with every member's
  // properties, which no individual member accepts.
  useCopilotAction(
    { ...tool, name: "*" } as CatchAllFrontendAction,
    dependencies,
  );
}
