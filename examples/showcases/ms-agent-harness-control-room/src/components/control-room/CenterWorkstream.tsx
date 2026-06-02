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
            title: "A2UI progress dashboard",
            message:
              "Please give me a dashboard with a bar chart and area chart describing progress. Render A2UI as the final action. Use render_control_room_a2ui exactly once with a flat components array: root Surface, a Row of three Metric nodes, and a Row of two Card nodes where one Card contains BarChart and the other contains AreaChart. Do not call TodoList, FileMemory, FileAccess, AgentMode, approval, shell, show... display tools, or any other display tool.",
          },
          {
            title: "A2UI controls panel",
            message:
              "Render A2UI as the final action. Use render_control_room_a2ui exactly once with a flat components array: root Surface, one Card containing a SectionHeader, Select, TextInput, Switch, Checkbox, Badge, and Button for a demo control panel. Do not call TodoList, FileMemory, FileAccess, AgentMode, approval, shell, show... display tools, or any other display tool.",
          },
          {
            title: "A2UI sidebar catalog",
            message:
              "Render A2UI as the final action. Use render_control_room_a2ui exactly once with a flat components array: root Surface with Cards for RunHealthTable, FileImpactMap, and ApprovalForm, using small illustrative data. Do not call TodoList, FileMemory, FileAccess, AgentMode, approval, shell, show... display tools, or any other display tool.",
          },
          {
            title: "A2UI chart set",
            message:
              "Render A2UI as the final action. Use render_control_room_a2ui exactly once with a flat components array: root Surface and a two-by-two chart dashboard containing LineChart, StackedAreaChart, DonutChart, and RadarChart inside Card containers. Do not call TodoList, FileMemory, FileAccess, AgentMode, approval, shell, show... display tools, or any other display tool.",
          },
        ]
      : []),
    {
      title: "Explore workspace",
      message:
        "Give me a concise orientation to this workspace. Use the workspace-analysis skill, read README.md, and list the top-level files with FileAccess before rendering anything visual. If you create todos, complete them before the visual. After the README read, top-level file list, and any todo results are visible, render exactly one showHarnessSummary component as the final action. Do not render showHarnessSummary before FileAccess_ListFiles completes. Do not call tools or write additional assistant text after the summary.",
    },
    {
      title: "Chart sample data",
      message:
        "Read data/revenue.csv with FileAccess first. After the file-read result is visible, render exactly one showBarChart component as the final action using the monthly revenue values from the CSV. Do not render any chart before the file-read result. Do not call additional tools after the chart.",
    },
    {
      title: "Plan an improvement",
      message:
        "Inspect the workspace and propose one small code or data improvement. Capture a short todo list and render one Run Health Table as the final action. Do not edit files unless I ask.",
    },
    {
      title: "Preview approval",
      message:
        "Show how Harness approval would work before a command runs. Render a simple Approval Form as the final action. Do not run shell commands.",
    },
    {
      title: "Create handoff",
      message:
        "Create a short handoff summary for this workspace. Save a concise note to memory if useful, then render one Handoff Form as the final action.",
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
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <CopilotChat
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
