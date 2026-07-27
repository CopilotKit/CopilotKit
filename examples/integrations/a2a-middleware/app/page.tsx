"use client";

import { useState } from "react";
import Chat from "@/components/chat";
import {
  CopilotChatConfigurationProvider,
  CopilotThreadsDrawer,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import styles from "./page.module.css";

export type ResearchData = {
  topic: string;
  summary: string;
  findings: Array<{
    title: string;
    description: string;
  }>;
  sources: string;
};

export type AnalysisData = {
  topic: string;
  overview: string;
  insights: Array<{
    title: string;
    description: string;
    importance: string;
  }>;
  conclusion: string;
};

// Disable static optimization for this page
export const dynamic = "force-dynamic";

function ResearchAssistant() {
  const [researchData, setResearchData] = useState<ResearchData | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);

  return (
    <div className="relative flex min-h-dvh overflow-hidden bg-[#DEDEE9] p-2">
      {/* Background blur circles - Creating the gradient effect */}
      <div
        className="absolute w-[445px] h-[445px] left-[1040px] top-[11px] rounded-full z-0"
        style={{ background: "rgba(255, 172, 77, 0.2)", filter: "blur(103px)" }}
      />
      <div
        className="absolute w-[609px] h-[609px] left-[1339px] top-[625px] rounded-full z-0"
        style={{ background: "#C9C9DA", filter: "blur(103px)" }}
      />
      <div
        className="absolute w-[609px] h-[609px] left-[670px] top-[-365px] rounded-full z-0"
        style={{ background: "#C9C9DA", filter: "blur(103px)" }}
      />
      <div
        className="absolute w-[445px] h-[445px] left-[128px] top-[331px] rounded-full z-0"
        style={{
          background: "rgba(255, 243, 136, 0.3)",
          filter: "blur(103px)",
        }}
      />

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto z-10 lg:flex-row lg:overflow-hidden">
        <div className="flex min-h-[calc(100dvh-1rem)] w-full flex-shrink-0 flex-col overflow-hidden rounded-lg border-2 border-white bg-white/50 shadow-elevation-lg backdrop-blur-md lg:w-[450px]">
          <div className="p-6 max-lg:pl-16 border-b border-[#DBDBE5]">
            <h1 className="text-2xl font-semibold text-[#010507] mb-1">
              Research Assistant
            </h1>
            <p className="text-sm text-[#57575B] leading-relaxed">
              Multi-Agent A2A Demo:{" "}
              <span className="text-[#1B936F] font-semibold">1 LangGraph</span>{" "}
              + <span className="text-[#BEC2FF] font-semibold">1 ADK</span>{" "}
              agent
            </p>
            <p className="text-xs text-[#838389] mt-1">
              Orchestrator-mediated A2A Protocol
            </p>
          </div>

          <div className="flex-1 overflow-hidden">
            <Chat
              onResearchUpdate={setResearchData}
              onAnalysisUpdate={setAnalysisData}
            />
          </div>
        </div>

        <div className="min-h-[520px] flex-1 overflow-y-auto rounded-lg bg-white/30 backdrop-blur-sm lg:min-h-0">
          <div className="mx-auto p-4 sm:p-8">
            <div className="mb-8">
              <h2 className="text-3xl font-semibold text-[#010507] mb-2">
                Research Results
              </h2>
              <p className="text-[#57575B]">
                Multi-agent coordination: LangGraph + ADK agents with A2A
                Protocol
              </p>
            </div>

            {!researchData && !analysisData && (
              <div className="flex items-center justify-center h-[400px] bg-white/60 backdrop-blur-md rounded-xl border-2 border-dashed border-[#DBDBE5] shadow-elevation-sm">
                <div className="text-center">
                  <div className="text-6xl mb-4">🔍</div>
                  <h3 className="text-xl font-semibold text-[#010507] mb-2">
                    Start Your Research
                  </h3>
                  <p className="text-[#57575B] max-w-md">
                    Ask the assistant to research any topic. Watch as 2
                    specialized agents collaborate through A2A Protocol to
                    gather information and provide insights.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 items-stretch xl:flex-row">
              {researchData && (
                <div className="flex-1 bg-white/60 backdrop-blur-md rounded-xl border-2 border-[#DBDBE5] shadow-elevation-md p-6">
                  <div className="flex flex-col gap-0 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">📚</span>
                      <h3 className="text-xl font-semibold text-[#010507]">
                        {researchData.topic}
                      </h3>
                      <span className="ml-auto px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-800 border-2 border-emerald-400">
                        🔗 Research Agent
                      </span>
                    </div>
                    <h4 className="text-lg font-semibold text-gray-500">
                      Key Points
                    </h4>
                  </div>
                  <p className="text-[#57575B] mb-4">{researchData.summary}</p>
                  <div className="space-y-3">
                    {researchData.findings.map((finding, index) => (
                      <div key={index} className="bg-white/80 rounded-lg p-4">
                        <h4 className="font-semibold text-[#010507] mb-1">
                          {finding.title}
                        </h4>
                        <p className="text-sm text-[#57575B]">
                          {finding.description}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-[#838389] mt-4 italic">
                    {researchData.sources}
                  </p>
                </div>
              )}

              {analysisData && (
                <div className="flex-1 bg-white/60 backdrop-blur-md rounded-xl border-2 border-[#DBDBE5] shadow-elevation-md p-6">
                  <div className="flex flex-col gap-0 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">💡</span>
                      <h3 className="text-xl font-semibold text-[#010507]">
                        {analysisData.topic}
                      </h3>
                      <span className="ml-auto px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-100 to-sky-100 text-blue-800 border-2 border-blue-400">
                        ✨ Analysis Agent
                      </span>
                    </div>
                    <h4 className="text-lg font-semibold text-gray-500">
                      Insights and Analysis
                    </h4>
                  </div>
                  <p className="text-[#57575B] mb-4">{analysisData.overview}</p>
                  <div className="space-y-3 mb-4">
                    {analysisData.insights.map((insight, index) => (
                      <div key={index} className="bg-white/80 rounded-lg p-4">
                        <h4 className="font-semibold text-[#010507] mb-1">
                          {insight.title}
                        </h4>
                        <p className="text-sm text-[#57575B] mb-2">
                          {insight.description}
                        </p>
                        <p className="text-xs text-blue-600 font-medium">
                          💡 {insight.importance}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-semibold text-blue-900 mb-1">
                      Conclusion
                    </h4>
                    <p className="text-sm text-blue-800">
                      {analysisData.conclusion}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      showDevConsole="auto"
      useSingleEndpoint={false}
    >
      {/*
        One UNCONTROLLED CopilotChatConfigurationProvider (no `threadId` prop)
        owns the active thread for the whole surface. The SDK <CopilotThreadsDrawer>
        drives it directly — picking a row sets the active thread, "+ New"
        resets to a fresh thread — with no host thread-state. The chat (inside
        ResearchAssistant) reads the same active thread from the provider. A
        *controlled* provider would block "+ New" from resetting, so
        uncontrolled-inside-provider is required, not optional.
      */}
      <CopilotChatConfigurationProvider agentId="a2a_chat">
        <div className={`${styles.layout} threadsLayout`}>
          {/* SDK threads drawer (replaces the hand-rolled fork). License-gated: the locked view's Upgrade CTA opens the Intelligence docs by default. */}
          <CopilotThreadsDrawer agentId="a2a_chat" />
          <div className={styles.mainPanel}>
            <ResearchAssistant />
          </div>
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}
