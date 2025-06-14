"use client";

import React from "react";
import { useCoAgent, useCopilotAction } from "@copilotkit/react-core";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import ReactMarkdown from "react-markdown";

export default function PraisonAIApp() {
  return (
    <CopilotKit 
      runtimeUrl="/api/copilotkit"
      agent="research_crew"
    >
      <MainContent />
      <CopilotPopup
        defaultOpen={true}
        labels={{
          title: "PraisonAI Research Assistant",
          initial: "Need any help with research?",
        }}
        clickOutsideToClose={false}
      />
    </CopilotKit>
  );
}

function MainContent() {
  const { state, setState } = useCoAgent({
    name: "research_crew",
    initialState: {
      inputs: {
        topic: "",
        current_year: "2025",
      },
      outputs: "Research report will appear here",
    },
  });

  // Add safety checks for state
  const safeState = {
    inputs: {
      topic: state?.inputs?.topic || "",
      current_year: state?.inputs?.current_year || "2025",
    },
    outputs: state?.outputs || "Research report will appear here",
  };

  useCopilotAction({
    name: "research_crew",
    parameters: [
      {
        name: "topic",
      },
      {
        name: "current_year",
      },
    ],
    render({ args, status }: any) {
      return (
        <div className="m-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg shadow-sm border border-blue-200">
          <h1 className="text-center text-sm text-blue-800 font-medium">
            🔬 PraisonAI Agents researching "{args?.topic || 'topic'}" in {args?.current_year || '2025'}{" "}
            {status == "complete" ? "✅" : "⏳"}
          </h1>
        </div>
      );
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 flex justify-center items-start">
      <div className="w-full max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              PraisonAI Research Assistant
            </h1>
            <p className="text-gray-600">
              Powered by PraisonAI Agents • Multi-agent research and reporting
            </p>
          </div>

          <form className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="currentYear"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Current Year
                </label>
                <input
                  type="text"
                  id="currentYear"
                  name="currentYear"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  value={safeState.inputs.current_year}
                  onChange={(e) =>
                    setState({
                      ...safeState,
                      inputs: { ...safeState.inputs, current_year: e.target.value },
                    })
                  }
                />
              </div>
              
              <div>
                <label
                  htmlFor="topic"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Research Topic
                </label>
                <input
                  type="text"
                  id="topic"
                  name="topic"
                  placeholder="e.g., Artificial Intelligence, Climate Change, Space Exploration"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  value={safeState.inputs.topic}
                  onChange={(e) =>
                    setState({
                      ...safeState,
                      inputs: { ...safeState.inputs, topic: e.target.value },
                    })
                  }
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="result"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Research Results
              </label>
              <div
                id="result"
                className="w-full min-h-[400px] px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white"
              >
                <MarkdownRenderer content={safeState.outputs} />
              </div>
            </div>
          </form>

          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <h3 className="text-sm font-medium text-blue-800 mb-2">How it works:</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• <strong>Researcher Agent:</strong> Conducts thorough research on your topic</li>
              <li>• <strong>Reporting Analyst:</strong> Creates detailed, structured reports</li>
              <li>• <strong>Multi-agent coordination:</strong> Agents work together sequentially</li>
              <li>• <strong>Real-time updates:</strong> See progress as agents work</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <ReactMarkdown
      components={{
        h1: ({ node, ...props }: any) => (
          <h1 className="text-2xl font-bold my-4 text-gray-900" {...props} />
        ),
        h2: ({ node, ...props }: any) => (
          <h2 className="text-xl font-semibold my-3 text-gray-800" {...props} />
        ),
        h3: ({ node, ...props }: any) => (
          <h3 className="text-lg font-medium my-2 text-gray-700" {...props} />
        ),
        p: ({ node, ...props }: any) => (
          <p className="mt-2 text-gray-600 leading-relaxed" {...props} />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc list-inside my-3 space-y-1" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal list-inside my-3 space-y-1" {...props} />
        ),
        li: ({ node, ...props }: any) => (
          <li className="ml-4 text-gray-600" {...props} />
        ),
        blockquote: ({ node, ...props }: any) => (
          <blockquote
            className="border-l-4 border-blue-300 pl-4 italic my-3 text-gray-600"
            {...props}
          />
        ),
        code: ({ node, ...props }: any) => (
          <code className="bg-gray-100 rounded px-2 py-1 text-sm font-mono" {...props} />
        ),
        pre: ({ node, ...props }: any) => (
          <pre className="bg-gray-100 rounded p-4 overflow-x-auto my-3" {...props} />
        ),
        a: ({ node, ...props }: any) => (
          <a className="text-blue-600 hover:text-blue-800 hover:underline" {...props} />
        ),
        strong: ({ node, ...props }: any) => (
          <strong className="font-semibold text-gray-800" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}; 