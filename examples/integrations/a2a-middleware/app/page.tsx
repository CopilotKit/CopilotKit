"use client";

import { useState } from "react";
import Chat from "@/components/chat";

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

export default function Home() {
  const [researchData, setResearchData] = useState<ResearchData | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);

  return (
    <div className="relative flex h-screen overflow-hidden bg-[#DEDEE9] p-2">
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
        style={{ background: "rgba(255, 243, 136, 0.3)", filter: "blur(103px)" }}
      />

      <div className="flex flex-1 overflow-hidden z-10 gap-2">
        <div className="w-[450px] flex-shrink-0 border-2 border-white bg-white/50 backdrop-blur-md shadow-elevation-lg flex flex-col rounded-lg overflow-hidden">
          <div className="p-6 border-b border-[#DBDBE5]">
            <h1 className="text-2xl font-semibold text-[#010507] mb-1">Research Assistant</h1>
            <p className="text-sm text-[#57575B] leading-relaxed">
              Multi-Agent A2A Demo:{" "}
              <span className="text-[#1B936F] font-semibold">1 LangGraph</span> +{" "}
              <span className="text-[#BEC2FF] font-semibold">1 ADK</span> agent
            </p>
            <p className="text-xs text-[#838389] mt-1">Orchestrator-mediated A2A Protocol</p>
          </div>

          <div className="flex-1 overflow-hidden">
            <Chat onResearchUpdate={setResearchData} onAnalysisUpdate={setAnalysisData} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-lg bg-white/30 backdrop-blur-sm">
          <div className="mx-auto p-8">
            <div className="mb-8">
              <h2 className="text-3xl font-semibold text-[#010507] mb-2">Research Results</h2>
              <p className="text-[#57575B]">
                Multi-agent coordination: LangGraph + ADK agents with A2A Protocol
              </p>
            </div>

            {!researchData && !analysisData && (
              <div className="flex items-center justify-center h-[400px] bg-white/60 backdrop-blur-md rounded-xl border-2 border-dashed border-[#DBDBE5] shadow-elevation-sm">
                <div className="text-center">
                  <div className="text-6xl mb-4">🔍</div>
                  <h3 className="text-xl font-semibold text-[#010507] mb-2">Start Your Research</h3>
                  <p className="text-[#57575B] max-w-md">
                    Ask the assistant to research any topic. Watch as 2 specialized agents
                    collaborate through A2A Protocol to gather information and provide insights.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-row gap-2 items-stretch">
              {researchData && (
                <div className="flex-1 bg-white/60 backdrop-blur-md rounded-xl border-2 border-[#DBDBE5] shadow-elevation-md p-6">
                  <div className="flex flex-col gap-0 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">📚</span>
                      <h3 className="text-xl font-semibold text-[#010507]">{researchData.topic}</h3>
                      <span className="ml-auto px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-800 border-2 border-emerald-400">
                        🔗 Research Agent
                      </span>
                    </div>
                    <h4 className="text-lg font-semibold text-gray-500">Key Points</h4>
                  </div>
                  <p className="text-[#57575B] mb-4">{researchData.summary}</p>
                  <div className="space-y-3">
                    {researchData.findings.map((finding, index) => (
                      <div key={index} className="bg-white/80 rounded-lg p-4">
                        <h4 className="font-semibold text-[#010507] mb-1">{finding.title}</h4>
                        <p className="text-sm text-[#57575B]">{finding.description}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-[#838389] mt-4 italic">{researchData.sources}</p>
                </div>
              )}

              {analysisData && (
                <div className="flex-1 bg-white/60 backdrop-blur-md rounded-xl border-2 border-[#DBDBE5] shadow-elevation-md p-6">
                  <div className="flex flex-col gap-0 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">💡</span>
                      <h3 className="text-xl font-semibold text-[#010507]">{analysisData.topic}</h3>
                      <span className="ml-auto px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-100 to-sky-100 text-blue-800 border-2 border-blue-400">
                        ✨ Analysis Agent
                      </span>
                    </div>
                    <h4 className="text-lg font-semibold text-gray-500">Insights and Analysis</h4>
                  </div>
                  <p className="text-[#57575B] mb-4">{analysisData.overview}</p>
                  <div className="space-y-3 mb-4">
                    {analysisData.insights.map((insight, index) => (
                      <div key={index} className="bg-white/80 rounded-lg p-4">
                        <h4 className="font-semibold text-[#010507] mb-1">{insight.title}</h4>
                        <p className="text-sm text-[#57575B] mb-2">{insight.description}</p>
                        <p className="text-xs text-blue-600 font-medium">💡 {insight.importance}</p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-semibold text-blue-900 mb-1">Conclusion</h4>
                    <p className="text-sm text-blue-800">{analysisData.conclusion}</p>
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
