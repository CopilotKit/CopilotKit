import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useGenerativeUIRuntime } from "@copilotkit/react-core/v2/generative-ui";
import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};
const noVersion = () => 0;

/**
 * The generative UI surface manager, re-rendering the caller whenever a
 * surface changes (an operation lands, a status flips).
 */
function useSurfaceManager() {
  const manager = useGenerativeUIRuntime()?.manager;
  useSyncExternalStore(
    manager?.subscribe ?? noSubscription,
    manager?.getVersion ?? noVersion,
    noVersion,
  );
  return manager;
}

/** The A2UI operations a chat surface has committed so far, live. */
export function useSurfaceOperations(surfaceId: string) {
  const manager = useSurfaceManager();
  const threadId = useCopilotChatConfiguration()?.threadId;
  const surface =
    manager && threadId ? manager.getSurface(threadId, surfaceId) : undefined;
  return surface?.operations ?? [];
}

/** The latest surface the agent wrote into a named page target, live. */
export function useTargetSurface(target: string) {
  return useSurfaceManager()?.getSurfaceForTarget(target);
}
