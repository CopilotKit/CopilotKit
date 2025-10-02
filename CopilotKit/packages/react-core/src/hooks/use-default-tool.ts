import { useCopilotAction } from "./use-copilot-action";
import { CatchAllFrontendAction } from "../types/frontend-action";

export function useDefaultTool(tool: CatchAllFrontendAction, dependencies?: any[]) {
  // Use the existing useCopilotAction hook
  useCopilotAction(tool, dependencies);
}
