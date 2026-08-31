import { ResearchCanvas } from "@/components/ResearchCanvas";
import { Progress } from "@/components/Progress";
import { useModelSelectorContext } from "@/lib/model-selector-provider";
import type { AgentState } from "@/lib/types";
import {
  CopilotChat,
  useAgent,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { useEffect } from "react";
import type { CSSProperties } from "react";

function normalizeAgentState(value: unknown, model: string): AgentState {
  const state =
    value !== null && typeof value === "object"
      ? (value as Partial<AgentState>)
      : {};

  return {
    model: state.model ?? model,
    research_question: state.research_question ?? "",
    resources: state.resources ?? [],
    report: state.report ?? "",
    logs: state.logs ?? [],
  };
}

export default function Main() {
  const { model, agent } = useModelSelectorContext();
  const { agent: researchAgent, isReady } = useAgent({
    agentId: agent,
  });
  const state = normalizeAgentState(researchAgent.state, model);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    researchAgent.setState(normalizeAgentState(researchAgent.state, model));
  }, [isReady, model, researchAgent]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const subscription = researchAgent.subscribe({
      onRunInitialized: ({ state: runState }) => ({
        state: {
          ...normalizeAgentState(runState, model),
          logs: [],
        },
      }),
    });

    return () => subscription.unsubscribe();
  }, [isReady, model, researchAgent]);

  useConfigureSuggestions({
    consumerAgentId: agent,
    providerAgentId: agent,
    available: "before-first-message",
    instructions: "Lifespan of penguins",
  });

  return (
    <>
      <h1 className="flex h-[60px] bg-[#0E103D] text-white items-center px-10 text-2xl font-medium">
        Research Helper
      </h1>

      <div
        className="flex flex-1 border"
        style={{ height: "calc(100vh - 60px)" }}
      >
        <div className="flex-1 overflow-hidden">
          <ResearchCanvas />
        </div>
        <div className="w-[500px] h-full flex flex-col flex-shrink-0">
          {state.logs.length > 0 && (
            <div className="border-b border-[#b8b8b8] bg-[#E0E9FD] p-4">
              <Progress logs={state.logs} />
            </div>
          )}
          <CopilotChat
            agentId={agent}
            className="min-h-0 flex-1"
            style={
              {
                "--background": "#E0E9FD",
                "--foreground": "#000000",
                "--primary": "#6766FC",
                "--primary-foreground": "#FFFFFF",
                "--border": "#b8b8b8",
                "--input": "#b8b8b8",
                "--ring": "#6766FC",
              } as CSSProperties
            }
            labels={{
              welcomeMessageText:
                "Hi! How can I assist you with your research today?",
            }}
          />
        </div>
      </div>
    </>
  );
}
