import type { Provider } from "@angular/core";
import { inject, InjectionToken } from "@angular/core";
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/core";

export type { CopilotChatLabels };

/**
 * The default English chat text. The same object as `CopilotChatDefaultLabels`
 * from `@copilotkit/core`, so React, Vue and Angular show the same text.
 */
export const COPILOT_CHAT_DEFAULT_LABELS = CopilotChatDefaultLabels;

/**
 * The chat text in scope. Set it with {@link provideCopilotChatLabels}, and
 * read it with {@link injectChatLabels}.
 */
export const COPILOT_CHAT_LABELS = new InjectionToken<CopilotChatLabels>(
  "COPILOT_CHAT_LABELS",
);

/**
 * Get the chat text in scope: the labels from the nearest
 * {@link provideCopilotChatLabels}, or the default English text when no
 * provider is in scope.
 *
 * Call it in an injection context, such as a component field initializer.
 *
 * @example
 * ```ts
 * readonly labels = injectChatLabels();
 * // labels.chatInputPlaceholder
 * ```
 */
export function injectChatLabels() {
  const labels: CopilotChatLabels =
    inject(COPILOT_CHAT_LABELS, { optional: true }) ?? CopilotChatDefaultLabels;
  return labels;
}

/**
 * Change or translate the chat text. Keys you leave out keep their default
 * English text.
 *
 * Some values are templates with `{name}` placeholders, such as
 * `"Thought for {duration}"`. Keep the placeholders when you translate them.
 *
 * @param config - The labels to change, by key.
 *
 * @example
 * ```ts
 * bootstrapApplication(App, {
 *   providers: [
 *     provideCopilotChatLabels({
 *       chatInputPlaceholder: "Frag mich etwas...",
 *       toolCallUsedToolsOther: "{count} Tools benutzt",
 *     }),
 *   ],
 * });
 * ```
 */
export function provideCopilotChatLabels(
  config: Partial<CopilotChatLabels>,
): Provider {
  return {
    provide: COPILOT_CHAT_LABELS,
    useValue: {
      ...CopilotChatDefaultLabels,
      ...config,
    },
  };
}
