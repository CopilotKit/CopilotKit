"use client";

/**
 * Center column: the conversational chat with the Control Room agent.
 *
 * As of Task 6, primitive renderers (shell output, file reads, diff
 * proposals, approval cards, generated results, observer snapshots) are
 * registered globally by `<ToolRendererRegistry />` (mounted inside
 * `<CopilotKit>` in `ControlRoomApp`). The chat surface itself renders each
 * tool call inline as it streams, so the dashed "Task 6 mounting slot" cards
 * that previously lived here are gone.
 */

import {
  CopilotChat,
  CopilotChatSuggestionView,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import type { CopilotChatSuggestionViewProps } from "@copilotkit/react-core/v2";
import { forwardRef, useMemo } from "react";

import {
  CONTROL_ROOM_AGENT_NAME,
  useControlRoomLocal,
} from "@/hooks/use-control-room-state";

function HiddenCopyButton() {
  return null;
}

const chatMessageView = {
  assistantMessage: {
    copyButton: HiddenCopyButton,
  },
  userMessage: {
    copyButton: HiddenCopyButton,
  },
};

const suggestionClassName = "cr-chat-suggestion";

const DedupedSuggestionView = forwardRef<
  HTMLDivElement,
  CopilotChatSuggestionViewProps
>(function DedupedSuggestionView(
  { suggestions, loadingIndexes, ...props },
  ref,
) {
  const { dedupedSuggestions, dedupedLoadingIndexes } = useMemo(() => {
    const seen = new Map<string, number>();
    const nextSuggestions: CopilotChatSuggestionViewProps["suggestions"] = [];
    const nextLoadingIndexes = new Set<number>();
    const loadingSet = new Set(loadingIndexes ?? []);

    suggestions.forEach((suggestion, index) => {
      const key = `${suggestion.title}\u0000${suggestion.message}`;
      const existingIndex = seen.get(key);

      if (existingIndex !== undefined) {
        if (loadingSet.has(index) || suggestion.isLoading) {
          nextLoadingIndexes.add(existingIndex);
        }
        return;
      }

      const nextIndex = nextSuggestions.length;
      seen.set(key, nextIndex);
      nextSuggestions.push(suggestion);
      if (loadingSet.has(index) || suggestion.isLoading) {
        nextLoadingIndexes.add(nextIndex);
      }
    });

    return {
      dedupedSuggestions: nextSuggestions,
      dedupedLoadingIndexes: Array.from(nextLoadingIndexes),
    };
  }, [suggestions, loadingIndexes]);

  return (
    <CopilotChatSuggestionView
      ref={ref}
      suggestions={dedupedSuggestions}
      loadingIndexes={dedupedLoadingIndexes}
      {...props}
    />
  );
});

export function ControlRoomSuggestions() {
  const { localState } = useControlRoomLocal();
  const suggestions = [
    ...(localState.a2uiEnabled
      ? [
          {
            title: "Progress dashboard",
            className: suggestionClassName,
            message:
              "Show me a progress dashboard with key metrics, a bar chart, and an area chart.",
          },
          {
            title: "Controls panel",
            className: suggestionClassName,
            message:
              "Create a compact controls panel for reviewing a run configuration.",
          },
          {
            title: "Workspace operations",
            className: suggestionClassName,
            message:
              "Show me a workspace operations view with run health, file impact, and approval readiness.",
          },
          {
            title: "Chart set",
            className: suggestionClassName,
            message:
              "Show me a compact chart dashboard with a few different chart types.",
          },
        ]
      : []),
    {
      title: "Audit workspace data",
      className: suggestionClassName,
      message: "Audit the sample workspace data and show me the results.",
    },
    {
      title: "Workspace health check",
      className: suggestionClassName,
      message:
        "Run a workspace health check on the sample project and show me the results.",
    },
    {
      title: "Project overview",
      className: suggestionClassName,
      message: "Show me a concise project overview dashboard.",
    },
    {
      title: "Revenue dashboard",
      className: suggestionClassName,
      message:
        "Show me a revenue dashboard with a bar chart and a trend chart.",
    },
    {
      title: "Plan an improvement",
      className: suggestionClassName,
      message: "Show me a small improvement plan with run health.",
    },
    {
      title: "Preview approval",
      className: suggestionClassName,
      message:
        "Preview what an approval would look like before running a command.",
    },
    {
      title: "Create handoff",
      className: suggestionClassName,
      message:
        "Show me a short handoff summary with owner, notes, and follow-ups.",
    },
  ];

  useConfigureSuggestions({
    suggestions,
    available: "before-first-message",
    consumerAgentId: CONTROL_ROOM_AGENT_NAME,
  });

  return null;
}

export function CenterWorkstream() {
  const { localState } = useControlRoomLocal();
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <CopilotChat
        threadId={localState.activeThreadId}
        agentId={CONTROL_ROOM_AGENT_NAME}
        className="h-full w-full"
        input={{ showDisclaimer: false }}
        messageView={chatMessageView}
        suggestionView={DedupedSuggestionView}
        labels={{
          modalHeaderTitle: "Control Room",
        }}
      />
    </div>
  );
}
