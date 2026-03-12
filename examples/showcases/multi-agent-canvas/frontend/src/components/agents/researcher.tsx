import { Log } from "@/components/coagents-provider";
import { ResearchLogs } from "@/components/research-logs";
import { ResearchPaperSkeleton } from "@/components/skeletons";
import { AvailableAgents } from "@/lib/available-agents";
import { useCoAgent, useCoAgentStateRender } from "@copilotkit/react-core";
import { CheckCircleIcon } from "lucide-react";
import { FC, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

export type Resource = {
  url: string;
  title: string;
  description: string;
};

export type ResearchAgentState = {
  model: string;
  research_question: string;
  report: string;
  resources: Resource[];
  logs: Log[];
};

export const AIResearchAgent: FC = () => {
  const [logs, setLogs] = useState<
    Array<{
      message: string;
      done: boolean;
    }>
  >([]);

  const isResearchInProgress = useRef(false);

  const { state: researchAgentState, stop: stopResearchAgent } =
    useCoAgent<ResearchAgentState>({
      name: AvailableAgents.RESEARCH_AGENT,
      initialState: {
        model: "openai",
        research_question: "",
        resources: [],
        report: "",
        logs: [],
      },
    });

  useEffect(() => {
    if (researchAgentState.logs) {
      setLogs((prevLogs) => {
        const newLogs = [...prevLogs];
        researchAgentState.logs.forEach((log) => {
          const existingLogIndex = newLogs.findIndex(
            (l) => l.message === log.message
          );
          if (existingLogIndex >= 0) {
            // Only update done status if changing from false to true
            if (log.done && !newLogs[existingLogIndex].done) {
              newLogs[existingLogIndex].done = true;
            }
          } else {
            newLogs.push(log);
          }
        });
        return newLogs;
      });
    }
  }, [researchAgentState.logs]);

  useCoAgentStateRender({
    name: AvailableAgents.RESEARCH_AGENT,
    handler: ({ nodeName }) => {
      // HACK nodeName __end__ stop the research agent
      if (nodeName === "__end__") {
        setTimeout(() => {
          stopResearchAgent();
        }, 1000);
      }
    },
    render: ({ status }) => {
      if (status === "inProgress") {
        isResearchInProgress.current = true;
        return <ResearchLogs logs={logs ?? []} />;
      }

      if (status === "complete") {
        isResearchInProgress.current = false;
        return (
          <div>
            <div className="prose max-w-none">
              <div className="flex items-center gap-2 text-green-600 mb-4">
                <CheckCircleIcon className="h-5 w-5" />
                <span>Research complete</span>
              </div>
            </div>
          </div>
        );
      }
    },
  });

  if (isResearchInProgress.current) {
    return (
      <div className="flex flex-col gap-4 h-full z-[999]">
        <ResearchPaperSkeleton />
      </div>
    );
  }

  if (!researchAgentState.report) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 h-full z-[999]">
      <div className="flex flex-col gap-2 p-6 bg-white rounded-lg shadow-sm">
        <ReactMarkdown
          className="prose prose-sm md:prose-base lg:prose-lg prose-slate max-w-none bg-gray-50 p-6 rounded-lg border border-gray-200"
          components={{
            h1: ({ children }) => (
              <h1 className="text-3xl font-bold mb-6 pb-2 border-b">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-2xl font-bold mb-4 mt-8">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-xl font-bold mb-3 mt-6">{children}</h3>
            ),
            p: ({ children }) => (
              <p className="mb-4 leading-relaxed">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="list-disc pl-6 mb-4 space-y-2">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal pl-6 mb-4 space-y-2">{children}</ol>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-gray-300 pl-4 py-2 my-6 bg-gray-50 rounded-r">
                {children}
              </blockquote>
            ),
          }}
        >
          {researchAgentState.report}
        </ReactMarkdown>
        {researchAgentState.resources &&
          researchAgentState.resources.length > 0 && (
            <div className="prose max-w-none z-[999] bg-gray-50 p-6 rounded-lg border border-gray-200">
              <h2 className="text-2xl font-bold mb-4 mt-8">Resources</h2>
              <ul className="list-disc pl-6 mb-4 space-y-2">
                {researchAgentState.resources.map((resource, index) => (
                  <li key={index} className="text-gray-700">
                    {resource.url ? (
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {resource.title || resource.url}
                      </a>
                    ) : (
                      resource.title
                    )}
                    {resource.description && (
                      <p className="text-sm text-gray-600 mt-1">
                        {resource.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>
    </div>
  );
};
