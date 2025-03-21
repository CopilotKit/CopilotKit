// @ts-nocheck
"use client";

import AgentStatus from "@/components/AgentStatus";
import { DebugViewer } from "@/components/DebugViewer";
import FormattedContent, { formatContent } from "@/components/FormattedContent";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useGlobalContext } from "@/context/GlobalContext";
import { useInput } from "@/hooks/useInput";
import { useWindowSize } from "@/hooks/useWindowSize";
import { formatText } from "@/lib/utils";
import {
  useCoAgent,
  useCoAgentStateRender,
  useCopilotAction,
  useCopilotChat,
} from "@copilotkit/react-core";
import {
  AgentState,
  CopilotChat,
  CopilotKitCSSProperties,
  DefaultResponseRenderer,
  DefaultStateRenderer,
  ResponseStatus,
} from "@copilotkit/react-ui";
import { MessageRole, TextMessage } from "@copilotkit/runtime-client-gql";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

interface CrewFeedback {
  timestamp: string;
  id: string;
  task_id: string;
  task_output: string;
}

// Simple skeleton item for loading state
const SkeletonItem = () => (
  <div className="py-0.5 animate-pulse">
    <div className="flex justify-between">
      <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-8"></div>
    </div>
    <div className="mt-0.5 h-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
  </div>
);

// Application state extending the library AgentState
interface AppState extends AgentState {
  inputs: {
    location: string;
    [key: string]: string;
  };
  result: string;
  status: ResponseStatus;
}

export default function Home() {
  const { location, setLocation } = useGlobalContext();
  const { appendMessage } = useCopilotChat();
  const { isMobile } = useWindowSize();
  const [direction, setDirection] = useState<"horizontal" | "vertical">(
    "horizontal"
  );

  useEffect(() => {
    setDirection(isMobile ? "vertical" : "horizontal");
  }, [isMobile]);

  const { state, name, running, setState } = useCoAgent<AppState>({
    name: "restaurant_finder_agent",
    initialState: {
      inputs: {
        location: location.city,
      },
      result: "Final result will appear here",
    },
  });

  /**
   * Appends a message to the chat with the given key and value
   * This would be used for programatically triggering Crew
   * @param key - The key of the input
   * @param value - The value of the input
   */
  const setInput = async (key: keyof AppState["inputs"], value: string) => {
    setState({
      ...state,
      inputs: {
        ...state.inputs,
        [key as string]: value,
      },
    });
    setTimeout(async () => {
      await appendMessage(
        new TextMessage({
          content: `My ${String(key)} is ${value}`,
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
    render: ({
      state,
      status,
    }: {
      state: AppState;
      status: ResponseStatus;
    }) => {
      return (
        <DefaultStateRenderer
          state={state}
          status={status}
          defaultCollapsed={true}
          SkeletonLoader={SkeletonItem}
          StateItemRenderer={({ item }) => {
            return (
              <div key={item.id}>
                <div className="text-xs">
                  <div className="opacity-70">
                    {"tool" in item ? item.tool : item.name}
                  </div>
                </div>

                {"thought" in item && item.thought && (
                  <div className="mt-0.5 text-xs opacity-80">
                    {item.thought}
                  </div>
                )}
                {"result" in item &&
                  item.result !== undefined &&
                  item.result !== null && (
                    <div className="mt-0.5 text-xs">
                      <FormattedContent
                        content={formatContent(item.result)}
                        showJsonLabel={false}
                        isCollapsed={true}
                      />
                    </div>
                  )}
                {"description" in item && item.description && (
                  <div className="mt-0.5 text-xs opacity-80">
                    {item.description}
                  </div>
                )}
              </div>
            );
          }}
        />
      );
    },
  });

  useCopilotAction({
    name: "crew_requesting_feedback",
    renderAndWaitForResponse({ status, args, respond }) {
      const feedback = args as CrewFeedback;
      return (
        <DefaultResponseRenderer
          response={{
            id: feedback.id || String(Date.now()),
            content: feedback.task_output || String(feedback),
            metadata: feedback,
          }}
          onRespond={(input: string) => {
            respond?.(input);
          }}
          status={status as ResponseStatus}
          ContentRenderer={({ content }) => (
            <div className="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-md shadow-sm p-4 h-full overflow-y-auto whitespace-pre-line text-left">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        />
      );
    },
  });

  const agentName = name.replace(/[^a-zA-Z0-9]/g, " ");

  return (
    <div className="w-full h-full relative">
      {/* Status Badge */}
      <AgentStatus running={running} state={{ status: state.status }} />

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
