"use client";

import { useCallback } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import type { Suggestion } from "@copilotkit/core";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";

/**
 * Custom suggestion view (the `suggestionView` slot of the docked
 * `CopilotSidebar`). It has two jobs:
 *
 * 1. Own the EMPTY conversation. CopilotChatView only renders its centered
 *    welcome screen when `hasExplicitThreadId` is false, and this demo always
 *    pins a threadId, so without this the pills sit at the top of a tall void.
 *    See the isEmptyConversation branch below.
 *
 * 2. Route what a click DOES through the active skin. The shell gives the skin
 *    first refusal via `skin.onSuggestionSelect` (e.g. banking's Q2 pill stages
 *    a PDF and drives the real composer). If the skin handled the click it
 *    returns true and the shell does nothing further; otherwise the shell takes
 *    the framework's default "send the suggestion's message" path.
 *
 * The skin owns any pill-specific behavior, so this view stays generic.
 */

// ChatGPT's prompt chips: neutral hairline outline on the conversation's own
// white, grey fill on hover. No brand color — this surface is ChatGPT, not the
// skin's brand.
const PILL_CLASS =
  "inline-flex items-center rounded-full border border-[#e3e3e3] bg-white px-3 py-1.5 text-[0.8125rem] text-[#0d0d0d] transition-colors hover:bg-[#f4f4f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d0d0d] dark:border-white/15 dark:bg-transparent dark:text-[#ececec] dark:hover:bg-white/10 dark:focus-visible:ring-white";

export function DemoSuggestionsView({
  suggestions,
  onSelectSuggestion,
}: {
  suggestions: Suggestion[];
  loadingIndexes?: ReadonlyArray<number>;
  onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
}) {
  const skin = useSkin();
  // Empty-conversation detection. CopilotChatView only renders its centered
  // welcome screen when `hasExplicitThreadId` is false, and this demo always
  // pins a threadId — so on a fresh thread the SDK falls back to the normal
  // layout and these pills land at the top of an empty message list, leaving a
  // tall void above the composer. We own that space instead: when there are no
  // messages yet, this slot becomes a proper ChatGPT-style empty state
  // (centered greeting with the pills beneath it).
  const { agent } = useAgent({ agentId: skin.id });
  const isEmptyConversation = (agent?.messages?.length ?? 0) === 0;

  const handleClick = useCallback(
    (suggestion: Suggestion, index: number) => {
      // Ignore clicks while a run is in flight. A second click sends a second
      // message over the top of the first, which showed up live as the same
      // prompt twice and left the previous run's tool call without a result —
      // and Intelligence then fails the whole thread with "Tool result is
      // missing for tool call ...". Cheaper to drop the extra click than to
      // recover a poisoned thread mid-demo.
      if (agent?.isRunning) return;

      // Give the active skin first refusal (e.g. banking's Q2 pill rides a real
      // PDF attachment). If it fully handles the click, stop here.
      if (skin.onSuggestionSelect?.(suggestion, index)) return;

      // Everything else: the framework's normal suggestion send.
      onSelectSuggestion?.(suggestion, index);
    },
    [onSelectSuggestion, agent, skin],
  );

  if (!suggestions.length) return null;

  const pills = suggestions.map((suggestion, index) => (
    <button
      key={`${suggestion.title}-${index}`}
      type="button"
      data-testid={`demo-suggestion-${index}`}
      onClick={() => handleClick(suggestion, index)}
      disabled={agent?.isRunning}
      className={cn(PILL_CLASS, agent?.isRunning && "opacity-50")}
    >
      {suggestion.title}
    </button>
  ));

  if (isEmptyConversation) {
    return (
      <div
        data-testid="demo-suggestions"
        // Owns the empty conversation: fills the height the SDK would have given
        // its welcome screen, so the greeting reads as centered instead of the
        // pills clinging to the top of a void.
        className="flex min-h-[58vh] flex-col items-center justify-center gap-5 px-3"
      >
        <div className="flex max-w-[22rem] flex-col items-center gap-2 text-center">
          <h2 className="text-[1.375rem] font-semibold tracking-tight text-[#0d0d0d] dark:text-[#ececec]">
            What can I help with?
          </h2>
          <p className="text-[0.8125rem] leading-relaxed text-[#6e6e6e] dark:text-[#b4b4b4]">
            {skin.identity.greeting ?? skin.identity.tagline}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">{pills}</div>
      </div>
    );
  }

  return (
    <div
      data-testid="demo-suggestions"
      className="flex flex-wrap gap-2 px-1 py-1"
    >
      {pills}
    </div>
  );
}

export default DemoSuggestionsView;
