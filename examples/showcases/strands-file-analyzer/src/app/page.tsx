"use client";

import {
  useDefaultTool,
  useCoAgent,
} from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { FileUpload } from "@/components/file-upload";
import {
  FindingsPanel,
  RedactedPanel,
  TweetsPanel,
  SummaryPanel,
} from "@/components/dashboard-panels";
import { DefaultToolCard } from "@/components/tool-cards";
import {
  FileInvestigatorState,
  INITIAL_STATE,
  UploadedFile,
} from "@/types/investigator";

export default function FileInvestigatorPage() {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Shared state with agent
  const { state, setState } = useCoAgent<FileInvestigatorState>({
    name: "file_investigator",
    initialState: INITIAL_STATE,
  });

  // Ref to track current state for use in tool handlers (avoids stale closure)
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Handle files change
  const handleFilesChange = useCallback(
    (files: UploadedFile[]) => {
      setState({
        ...state,
        uploadedFiles: files,
        analysisStatus: "idle",
        // Reset results when files change
        findings: [],
        redactedContent: [],
        tweets: [],
        summary: null,
      });
    },
    [state, setState]
  );

  // Handle tweet copy
  const handleCopyTweet = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    setToastMessage("Tweet copied! Handle with care...");
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  // Handle mock tweet post
  const handlePostTweet = useCallback(
    (id: string) => {
      setState({
        ...stateRef.current,
        tweets: stateRef.current.tweets.map((t) =>
          t.id === id ? { ...t, posted: true } : t
        ),
      });
      setToastMessage("Tweet posted! The truth is out there.");
      setTimeout(() => setToastMessage(null), 2000);
    },
    [setState]
  );

  // Handle tweet edit
  const handleEditTweet = useCallback(
    (id: string, newContent: string) => {
      setState({
        ...stateRef.current,
        tweets: stateRef.current.tweets.map((t) =>
          t.id === id ? { ...t, content: newContent } : t
        ),
      });
    },
    [setState]
  );

  // Tools update state directly, dashboard panels render from state

  // === Default Tool Renderer ===
  useDefaultTool({
    render: (props) => (
      <DefaultToolCard
        name={props.name}
        status={props.status}
        args={props.args}
        result={props.result}
      />
    ),
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-4 right-4 bg-slate-900 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in">
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">File Investigator</h1>
              <p className="text-sm text-slate-500">AI-powered document analysis</p>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            Powered by things that didn&apos;t happen
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Upload + Panels */}
          <div className="lg:col-span-2 flex flex-col h-[calc(100vh-120px)]">
            {/* File Upload */}
            <div className="flex-shrink-0 mb-6">
              <FileUpload
                onFilesChange={handleFilesChange}
                currentFiles={state.uploadedFiles}
              />
            </div>

            {/* Results Grid - fills remaining space, 2 rows split evenly */}
            <div className="grid grid-cols-1 md:grid-cols-2 grid-rows-2 gap-6 flex-1 min-h-0">
              <FindingsPanel findings={state.findings} />
              <RedactedPanel redactedItems={state.redactedContent} />
              <TweetsPanel
                tweets={state.tweets}
                onCopy={handleCopyTweet}
                onPost={handlePostTweet}
                onEdit={handleEditTweet}
              />
              <SummaryPanel summary={state.summary} />
            </div>
          </div>

          {/* Right Column: Chat */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-[calc(100vh-180px)] overflow-hidden">
              <CopilotChat
                labels={{
                  title: "Investigation Assistant",
                  initial: "Upload a PDF and I'll help you investigate it. Some documents have more... interesting... contents than others.",
                  placeholder: "Ask me to analyze the document...",
                }}
                className="h-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
