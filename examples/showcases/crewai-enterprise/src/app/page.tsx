"use client";

import { AgenticUI } from "@/components/AgenticUI";
import AgentStatus from "@/components/AgentStatus";
import { DebugViewer } from "@/components/DebugViewer";
import { Feedback, SubmitCrewFeedback } from "@/components/SubmitCrewFeedback";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useGlobalContext } from "@/context/GlobalContext";
import { useInput } from "@/hooks/useInput";
import { useWindowSize } from "@/hooks/useWindowSize";
import { AgentState, RunStatus } from "@/types/agent";
import {
  useCoAgent,
  useCoAgentStateRender,
  useCopilotAction,
  useCopilotChat,
} from "@copilotkit/react-core";
import { CopilotChat, CopilotKitCSSProperties } from "@copilotkit/react-ui";
import { MessageRole } from "@copilotkit/runtime-client-gql";
import { TextMessage } from "@copilotkit/runtime-client-gql";
import { useEffect, useState, useRef } from "react";
import { formatText } from "@/lib/utils";
export default function Home() {
  const { location, setLocation } = useGlobalContext();
  const { appendMessage } = useCopilotChat();
  const { isMobile } = useWindowSize();
  const [direction, setDirection] = useState<"horizontal" | "vertical">(
    "horizontal"
  );

  const [userFeedback, setUserFeedback] = useState<string>("");
  const latestUserFeedbackRef = useRef<string>("");

  const [agentStatus, setAgentStatus] = useState<RunStatus>("complete");
  const latestStatusRef = useRef<RunStatus>("complete");

  useEffect(() => {
    setDirection(isMobile ? "vertical" : "horizontal");
  }, [isMobile]);

  const { state, name, running, setState } = useCoAgent<AgentState>({
    name: "restaurant_finder_agent",
    initialState: {
      inputs: {
        location: location.city,
      },
      result: "List of restaurants will appear here",
      steps: [],
      tasks: [],
      messages: [],
      human_inputs: [],
      status: "completed",
    },
  });

  /**
   * Appends a message to the chat with the given key and value
   * This would be used for programatically triggering Crew
   * @param key - The key of the input
   * @param value - The value of the input
   */
  const setInput = async (key: keyof AgentState["inputs"], value: string) => {
    setState({
      ...state,
      inputs: {
        ...state.inputs,
        [key]: value,
      },
    });
    setTimeout(async () => {
      await appendMessage(
        new TextMessage({
          content: `My ${key} is ${value}`,
          role: MessageRole.Developer,
        })
      );
    }, 1000);
  };

  useInput({
    onInputSubmit: (city) => {
      setInput("location", city);
    },
  });

  // Update location.city if state.inputs.location changes
  useEffect(() => {
    if (state?.inputs?.location && state.inputs.location !== location.city) {
      setLocation({ ...location, city: state.inputs.location });
    }
  }, [state?.inputs?.location, location, setLocation]);

  useCoAgentStateRender({
    name: "restaurant_finder_agent",
    render: ({ state, status }: { state: AgentState; status: RunStatus }) => {
      // Store status in ref without triggering re-renders during render phase
      latestStatusRef.current = status;

      return <AgenticUI state={state} status={status} />;
    },
  });

  // Effect to update agent status after render
  useEffect(() => {
    if (latestStatusRef.current !== agentStatus) {
      setAgentStatus(latestStatusRef.current);
    }
  }, [agentStatus]);

  useEffect(() => {
    if (userFeedback !== latestUserFeedbackRef.current) {
      setUserFeedback(latestUserFeedbackRef.current);
    }
  }, [userFeedback]);

  useCopilotAction({
    name: "crew_requesting_feedback",
    renderAndWaitForResponse({ status, args, respond }) {
      latestUserFeedbackRef.current = userFeedback;
      if (status === "inProgress" || status === "executing") {
        return (
          <SubmitCrewFeedback
            feedback={args as Feedback}
            respond={(feedback) => {
              latestUserFeedbackRef.current = feedback;
              setUserFeedback(feedback); // Directly set state too
              respond?.(feedback);
            }}
          />
        );
      }

      // Show feedback immediately after submission
      if (status === "complete" && latestUserFeedbackRef.current) {
        return (
          <div className="flex justify-end">
            <div className="bg-gray-50 dark:bg-gray-800 p-2 rounded-md inline-flex items-center">
              <p className="text-gray-700 dark:text-gray-300 text-xs">
                User feedback:{" "}
                <span className="font-medium text-black dark:text-white">
                  {latestUserFeedbackRef.current}
                </span>
              </p>
            </div>
          </div>
        );
      }

      // Return an empty fragment when there's no feedback to display
      return <></>;
    },
  });

  const agentName = name.replace(/[^a-zA-Z0-9]/g, " ");

  return (
    <div className="w-full h-full relative">
      {/* Status Badge */}
      <AgentStatus running={running} state={state} />

      {/* Debug Viewer - Fixed at bottom right corner of page */}
      <div className="fixed bottom-4 right-4 z-50">
        <DebugViewer state={state} />
      </div>

      <ResizablePanelGroup direction={direction} className="w-full h-full">
        <ResizablePanel defaultSize={60} minSize={30}>
          <div
            className="h-full relative overflow-y-auto"
            style={
              {
                "--copilot-kit-primary-color": "#4F4F4F",
              } as CopilotKitCSSProperties
            }
          >
            <CopilotChat
              instructions={process.env.NEXT_PUBLIC_COPILOT_INSTRUCTIONS}
              className="h-full flex flex-col"
              icons={{
                spinnerIcon: (
                  <span className="h-5 w-5 text-gray-500 animate-pulse">
                    ...
                  </span>
                ),
              }}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={40} minSize={25}>
          <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 p-3">
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between mb-2">
                <h1 className="text-lg font-medium text-gray-800 dark:text-gray-200">
                  {agentName}
                </h1>
              </div>

              <div className="h-full">
                <div className="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-md shadow-sm p-4 h-full overflow-y-auto whitespace-pre-line">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: formatText(state.result),
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
