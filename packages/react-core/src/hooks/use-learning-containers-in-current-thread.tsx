import { useCopilotChatConfiguration } from "../providers";
import type { UseLearningContainersArgs } from "./use-learning-containers";
import { useLearningContainers } from "./use-learning-containers";

/**
 * Arguments for {@link useLearningContainersInCurrentThread}.
 * Same as {@link UseLearningContainersArgs} minus `threadId`, which is
 * sourced from the surrounding `<CopilotChatConfigurationProvider>` at
 * render time.
 *
 * @deprecated This type supports only the legacy plural-container annotation.
 * Configure `getLearningContainerId` on `CopilotKitIntelligence` for new
 * Intelligence runtimes.
 */
export type UseLearningContainersInCurrentThreadArgs = Omit<
  UseLearningContainersArgs,
  "threadId"
>;

/**
 * Legacy compatibility hook that keeps the **current chat thread's** plural
 * learning-container annotation in sync. The `threadId` is sourced from the surrounding
 * `<CopilotChatConfigurationProvider>` (the same provider `<CopilotChat>`,
 * `<CopilotSidebar>`, and friends set up), so callers in a chat-aware
 * subtree don't need to thread an id through manually.
 *
 * **Throws on render** when there is no chat-config provider in scope or
 * when the provider does not yet have an active `threadId`. Mount the hook
 * inside a subtree that is guaranteed to have a thread context.
 *
 * If you need to manage an explicit thread, use {@link useLearningContainers}
 * directly — two hooks, two crisp contracts, no mode confusion.
 *
 * @throws When no `CopilotChatConfigurationProvider` is in scope or when the
 *         active `threadId` is absent/empty.
 *
 * @example
 * ```tsx
 * function ThreadPanel({ scope }: Props) {
 *   useLearningContainersInCurrentThread({
 *     learningContainers: [scope],
 *   });
 *   // ...
 * }
 * ```
 *
 * @deprecated This hook supports only the legacy plural-container annotation.
 * Configure `getLearningContainerId` on `CopilotKitIntelligence` for new
 * Intelligence runtimes.
 */
export function useLearningContainersInCurrentThread({
  learningContainers,
}: UseLearningContainersInCurrentThreadArgs): void {
  const config = useCopilotChatConfiguration();
  const threadId = config?.threadId;

  if (!threadId) {
    throw new Error(
      "useLearningContainersInCurrentThread must be used within a thread context (no active threadId). " +
        "Wrap the component in <CopilotChat>, <CopilotSidebar>, or <CopilotChatConfigurationProvider>, " +
        "or use `useLearningContainers()` and pass `threadId` explicitly.",
    );
  }

  // Delegate to the base hook. The threadId is stable from the config context.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useLearningContainers({ threadId, learningContainers });
}
