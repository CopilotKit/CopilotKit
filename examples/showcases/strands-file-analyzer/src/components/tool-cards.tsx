"use client";

import { useState } from "react";

// === Analysis Proposal Card (message-based approval) ===
interface AnalysisProposalCardProps {
  fileName: string;
  proposedAnalyses: string[];
  status: "inProgress" | "executing" | "complete";
  onApprove?: () => void;
  onDeny?: () => void;
}

export function AnalysisProposalCard({
  fileName,
  proposedAnalyses,
  onApprove,
  onDeny,
}: Omit<AnalysisProposalCardProps, "status">) {
  const [responded, setResponded] = useState<"approved" | "denied" | null>(null);

  const handleApprove = () => {
    setResponded("approved");
    onApprove?.();
  };

  const handleDeny = () => {
    setResponded("denied");
    onDeny?.();
  };

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200 my-4 max-w-md">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <h3 className="font-semibold text-slate-900">Investigation Proposal</h3>
      </div>

      <p className="text-sm text-slate-600 mb-3">
        Ready to analyze <span className="font-medium text-slate-900">{fileName}</span>
      </p>

      <div className="bg-white/50 rounded-lg p-3 mb-4">
        <p className="text-xs font-medium text-slate-500 mb-2">Proposed analyses:</p>
        <ul className="space-y-1">
          {proposedAnalyses.map((analysis, i) => (
            <li key={i} className="text-sm text-slate-700 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              {analysis}
            </li>
          ))}
        </ul>
      </div>

      {responded === "approved" ? (
        <div className="flex items-center gap-2 text-green-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">Investigation approved</span>
        </div>
      ) : responded === "denied" ? (
        <div className="flex items-center gap-2 text-red-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="font-medium">Investigation declined</span>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Let&apos;s Investigate
          </button>
          <button
            onClick={handleDeny}
            className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg transition-colors"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

// === Status Progress Card (simple message display) ===
interface StatusProgressCardProps {
  message: string;
  toolStatus: "inProgress" | "executing" | "complete";
}

export function StatusProgressCard({ message, toolStatus }: StatusProgressCardProps) {
  const isComplete = toolStatus === "complete";

  return (
    <div className={`rounded-xl p-4 my-3 max-w-md border ${
      isComplete
        ? "bg-green-50 border-green-200"
        : "bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200"
    }`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isComplete ? "bg-green-100" : "bg-indigo-100"
        }`}>
          {isComplete ? (
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <div className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          )}
        </div>
        <p className={`text-sm ${isComplete ? "text-green-600" : "text-slate-600"} font-mono`}>
          {message}
        </p>
      </div>
    </div>
  );
}

// === Analysis Progress Card (for update_* tools) ===
interface AnalysisProgressCardProps {
  toolName: string;
  status: "inProgress" | "executing" | "complete";
  args: Record<string, unknown>;
}

const TOOL_CONFIG: Record<string, { icon: string; label: string; loadingText: string }> = {
  update_findings: {
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
    label: "Populating Findings Panel",
    loadingText: "Adding findings to dashboard...",
  },
  update_redacted: {
    icon: "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21",
    label: "Populating Redacted Panel",
    loadingText: "Adding speculations to dashboard...",
  },
  update_tweets: {
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
    label: "Populating Tweets Panel",
    loadingText: "Adding tweets to dashboard...",
  },
  update_summary: {
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    label: "Populating Summary Panel",
    loadingText: "Adding summary to dashboard...",
  },
};

export function AnalysisProgressCard({ toolName, status }: AnalysisProgressCardProps) {
  const config = TOOL_CONFIG[toolName] || {
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    label: toolName,
    loadingText: "Processing...",
  };

  const isComplete = status === "complete";

  return (
    <div className={`rounded-xl p-4 my-3 max-w-sm border ${
      isComplete
        ? "bg-green-50 border-green-200"
        : "bg-slate-50 border-slate-200"
    }`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          isComplete ? "bg-green-100" : "bg-blue-100"
        }`}>
          {isComplete ? (
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
          )}
        </div>
        <div className="flex-1">
          <p className={`font-medium ${isComplete ? "text-green-700" : "text-slate-700"}`}>
            {config.label}
          </p>
          <p className="text-xs text-slate-500">
            {isComplete ? "Complete" : config.loadingText}
          </p>
        </div>
      </div>
    </div>
  );
}

// === Default Tool Card (fallback) ===
interface DefaultToolCardProps {
  name: string;
  status: "inProgress" | "executing" | "complete";
  args: Record<string, unknown>;
  result?: unknown;
}

export function DefaultToolCard({ name, status, args, result }: DefaultToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-slate-100 rounded-lg p-4 my-3 max-w-md border border-slate-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-slate-700">{name}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            status === "complete"
              ? "bg-green-100 text-green-700"
              : "bg-blue-100 text-blue-700"
          }`}>
            {status}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-slate-400 hover:text-slate-600"
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2">
          <div>
            <p className="text-xs text-slate-500 mb-1">Arguments:</p>
            <pre className="text-xs bg-white p-2 rounded overflow-auto">{JSON.stringify(args, null, 2)}</pre>
          </div>
          {result !== undefined && result !== null && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Result:</p>
              <pre className="text-xs bg-white p-2 rounded overflow-auto">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
