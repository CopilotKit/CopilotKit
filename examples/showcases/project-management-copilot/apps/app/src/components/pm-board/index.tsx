"use client";

import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { IssueBoard } from "./issue-board";
import type { Issue } from "./types";
import { AnalysisTimeline } from "./analysis-timeline";

export function PmBoard() {
  // useAgent() only falls back its threadId to the enclosing chat config —
  // agentId still defaults to DEFAULT_AGENT_ID. Without passing it explicitly,
  // the board resolves to a different agent clone than the chat and never
  // sees the issues the chat agent is mutating.
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: config?.agentId });
  const issues = agent.state?.issues as Issue[] | undefined;

  return (
    <div className="h-full" style={{ position: "relative" }}>
      {issues === undefined ? (
        <BoardLoading />
      ) : issues.length === 0 ? (
        <BoardEmpty
          onCreate={() =>
            agent.setState({
              issues: [
                {
                  id: `ISS-${Math.floor(Math.random() * 9000 + 1000)}`,
                  title: "First issue",
                  description: "",
                  status: "Backlog",
                  priority: "Med",
                  assignee: null,
                  labels: [],
                },
              ],
            })
          }
        />
      ) : (
        <IssueBoard
          issues={issues}
          onUpdate={(updated) => agent.setState({ issues: updated })}
          isAgentRunning={agent.isRunning}
        />
      )}
      <AnalysisTimeline />
    </div>
  );
}

function BoardLoading() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        height: "100%",
        padding: 24,
        display: "flex",
        gap: 12,
      }}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            width: 240,
            background: "rgba(255,255,255,0.3)",
            border: "2px dashed transparent",
            borderRadius: 8,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              height: 12,
              width: 80,
              background: "rgba(255,255,255,0.65)",
              borderRadius: 4,
            }}
          />
          {[0, 1, 2].map((j) => (
            <div
              key={j}
              style={{
                height: 56,
                background: "rgba(255,255,255,0.5)",
                borderRadius: 6,
                opacity: 0.6 - j * 0.15,
                animation: "pulse 1.6s ease-in-out infinite",
                animationDelay: `${j * 0.15}s`,
              }}
            />
          ))}
        </div>
      ))}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}

function BoardEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.65)",
          border: "2px solid #ffffff",
          borderRadius: 8,
          padding: 24,
          maxWidth: 360,
          textAlign: "center",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 400,
            color: "#57575b",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 6,
          }}
        >
          Empty board
        </div>
        <h3
          style={{ margin: 0, fontSize: 18, fontWeight: 300, color: "#010507" }}
        >
          No issues yet
        </h3>
        <p
          style={{
            margin: "6px 0 14px",
            fontSize: 13,
            color: "#57575b",
            lineHeight: 1.45,
          }}
        >
          Ask the copilot to create some, attach a PRD PDF to extract issues, or
          add one manually.
        </p>
        <button
          onClick={onCreate}
          style={{
            padding: "6px 14px",
            background: "#010507",
            color: "#ffffff",
            border: 0,
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Create the first issue
        </button>
      </div>
    </div>
  );
}

export { type Issue } from "./types";
