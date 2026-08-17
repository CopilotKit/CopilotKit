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
