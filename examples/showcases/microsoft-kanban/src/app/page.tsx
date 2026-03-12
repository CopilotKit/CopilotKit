"use client";

import {
  useCoAgent,
  useCopilotAdditionalInstructions,
  useRenderToolCall,
} from "@copilotkit/react-core";
import { ToolCallCard } from "@/components/ToolCallCard";
import {
  CopilotKitCSSProperties,
  CopilotChat,
  CopilotPopup,
} from "@copilotkit/react-ui";
import { useEffect, useRef } from "react";
import { PopupHeader } from "@/components/kanban/AppChatHeader";
import type { AgentState } from "@/lib/kanban/types";
import { initialState, isNonEmptyAgentState } from "@/lib/kanban/state";
import useMediaQuery from "@/hooks/use-media-query";
import KanbanBoard from "@/components/kanban/KanbanBoard";
import BoardTabs from "@/components/kanban/BoardTabs";

export default function CopilotKitPage() {
  const { state, setState } = useCoAgent<AgentState>({
    name: "my_agent",
    initialState,
  });

  // 🔧 Tool Call Debugging: Render cards showing tool calls in the chat
  useRenderToolCall({
    name: "get_state",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="get_state"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "create_board",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="create_board"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "delete_board",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="delete_board"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "rename_board",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="rename_board"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "switch_board",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="switch_board"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "create_task",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="create_task"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "update_task_field",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="update_task_field"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "add_task_tag",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="add_task_tag"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "remove_task_tag",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="remove_task_tag"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "move_task_to_status",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="move_task_to_status"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  useRenderToolCall({
    name: "delete_task",
    render: ({ args, status, result }) => (
      <ToolCallCard
        name="delete_task"
        args={args}
        status={status}
        result={result}
      />
    ),
  });

  const cachedStateRef = useRef<AgentState>(state ?? initialState);
  useEffect(() => {
    if (isNonEmptyAgentState(state)) {
      cachedStateRef.current = state as AgentState;
    }
  }, [state]);

  const viewState: AgentState = isNonEmptyAgentState(state)
    ? (state as AgentState)
    : cachedStateRef.current;
  useEffect(() => {
    console.log("Current state:");
    console.log(viewState);
  }, [viewState]);

  const isDesktop = useMediaQuery("(min-width: 768px)");

  const handleSwitchBoard = (boardId: string) => {
    setState({ ...viewState, activeBoardId: boardId });
  };

  const handleCreateBoard = () => {
    const name = prompt("Enter board name:");
    if (name) {
      console.log(`[BoardTabs] Create board requested: ${name}`);
    }
  };

  // Task management handlers for UI-driven updates
  const handleUpdateTaskTitle = (taskId: string, title: string) => {
    console.log(`[Task] Update title: ${taskId} -> ${title}`);
    setState((prev) => {
      const boards = (prev?.boards ?? initialState.boards).map((board) => ({
        ...board,
        tasks: board.tasks.map((task) =>
          task.id === taskId ? { ...task, title } : task,
        ),
      }));
      return { ...viewState, boards };
    });
  };

  const handleUpdateTaskSubtitle = (taskId: string, subtitle: string) => {
    console.log(`[Task] Update subtitle: ${taskId} -> ${subtitle}`);
    setState((prev) => {
      const boards = (prev?.boards ?? initialState.boards).map((board) => ({
        ...board,
        tasks: board.tasks.map((task) =>
          task.id === taskId ? { ...task, subtitle } : task,
        ),
      }));
      return { ...viewState, boards };
    });
  };

  const handleAddTaskTag = (taskId: string, tag: string) => {
    console.log(`[Task] Add tag: ${taskId} -> ${tag}`);
    setState((prev) => {
      const boards = (prev?.boards ?? initialState.boards).map((board) => ({
        ...board,
        tasks: board.tasks.map((task) =>
          task.id === taskId && !task.tags.includes(tag)
            ? { ...task, tags: [...task.tags, tag] }
            : task,
        ),
      }));
      return { ...viewState, boards };
    });
  };

  const handleRemoveTaskTag = (taskId: string, tag: string) => {
    console.log(`[Task] Remove tag: ${taskId} -> ${tag}`);
    setState((prev) => {
      const boards = (prev?.boards ?? initialState.boards).map((board) => ({
        ...board,
        tasks: board.tasks.map((task) =>
          task.id === taskId
            ? { ...task, tags: task.tags.filter((t) => t !== tag) }
            : task,
        ),
      }));
      return { ...viewState, boards };
    });
  };

  useEffect(() => {
    console.log("[CoAgent state updated]", state);
  }, [state]);

  useCopilotAdditionalInstructions({
    instructions: (() => {
      const boards = viewState.boards ?? initialState.boards;
      const activeBoardId =
        viewState.activeBoardId ?? initialState.activeBoardId;
      const activeBoard = boards.find((b) => b.id === activeBoardId);
      const boardInfo = activeBoard
        ? `Active Board: "${activeBoard.name}" (${activeBoard.tasks.length} tasks)`
        : "No active board";

      const schema = [
        "KANBAN STRUCTURE:",
        "- Board: { id, name, tasks[] }",
        "- Task: { id, title, subtitle, description, tags[], status }",
        "- Status values: 'new' | 'in_progress' | 'review' | 'completed'",
        "",
        "USAGE HINTS:",
        "- Use switch_board to change active board",
        "- Use tags for categorization (bug, feature, urgent, etc.)",
        "- Status progression: new → in_progress → review → completed",
      ].join("\n");

      return [
        "ALWAYS ANSWER FROM SHARED STATE (GROUND TRUTH).",
        boardInfo,
        schema,
      ].join("\n\n");
    })(),
  });

  return (
    <div
      style={
        { "--copilot-kit-primary-color": "#2563eb" } as CopilotKitCSSProperties
      }
      className="relative h-screen flex flex-col bg-[#DEDEE9] p-2"
    >
      {/* Gradient Orbs Background */}
      <div
        className="absolute w-[445.84px] h-[445.84px] left-[127.91px] top-[331px] rounded-full z-0"
        style={{
          background: "rgba(255, 243, 136, 0.3)",
          filter: "blur(103.196px)",
        }}
      />

      <div className="flex flex-1 overflow-hidden z-10 gap-2">
        <aside className="-order-1 max-md:hidden flex flex-col min-w-80 w-[30vw] max-w-120">
          <div className="h-full flex flex-col align-start w-full border-2 border-white bg-white/50 backdrop-blur-md shadow-elevation-lg rounded-lg overflow-hidden">
            <div className="p-6 border-b border-[#DBDBE5]">
              <h1 className="text-xl font-semibold text-[#010507] mb-1">
                Kanban Board
              </h1>
              <p className="text-sm text-[#57575B]">
                AI-powered task management
              </p>
            </div>
            {isDesktop && (
              <CopilotChat
                className="flex-1 overflow-auto w-full"
                labels={{
                  title: "Agent",
                  initial:
                    "Welcome to your Kanban board! Ask me to help manage tasks.",
                }}
                suggestions={[
                  { title: "Add a Task", message: "Create a new task." },
                  {
                    title: "Move Task",
                    message: "Move a task to another status.",
                  },
                  { title: "List Tasks", message: "Show all tasks." },
                ]}
              />
            )}
          </div>
        </aside>
        <main className="relative flex flex-1 h-full flex-col rounded-lg bg-white/30 backdrop-blur-sm overflow-hidden">
          <BoardTabs
            boards={viewState.boards}
            activeBoardId={viewState.activeBoardId}
            onSwitchBoard={handleSwitchBoard}
            onCreateBoard={handleCreateBoard}
          />
          <div className="flex-1 overflow-auto">
            <KanbanBoard
              boards={viewState.boards}
              activeBoardId={viewState.activeBoardId}
              onUpdateTaskTitle={handleUpdateTaskTitle}
              onUpdateTaskSubtitle={handleUpdateTaskSubtitle}
              onAddTaskTag={handleAddTaskTag}
              onRemoveTaskTag={handleRemoveTaskTag}
            />
          </div>
        </main>
      </div>
      <div className="md:hidden">
        {!isDesktop && (
          <CopilotPopup
            Header={PopupHeader}
            labels={{
              title: "Agent",
              initial:
                "Welcome to your Kanban board! Ask me to help manage tasks.",
            }}
            suggestions={[
              { title: "Add a Task", message: "Create a new task." },
              { title: "Move Task", message: "Move a task to another status." },
              { title: "List Tasks", message: "Show all tasks." },
            ]}
          />
        )}
      </div>
    </div>
  );
}
