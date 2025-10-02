import { useCopilotAction } from "./use-copilot-action";
import { CatchAllFrontendAction } from "../types/frontend-action";

export function useDefaultTool(tool: Omit<CatchAllFrontendAction, 'name'>, dependencies?: any[]) {
  // Use the existing useCopilotAction hook
  useCopilotAction({ ...tool, name: '*' } satisfies CatchAllFrontendAction, dependencies);
}
