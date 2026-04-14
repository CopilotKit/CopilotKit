"use client";

import React, { useState, useEffect, useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
} from "@copilotkit/showcase-shared";

interface AgentState {
  document: string;
}

export default function SharedStateStreamingDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="shared-state-streaming"
      a2ui={{ catalog: demonstrationCatalog }}
    >
      <div className="min-h-screen w-full">
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            modalHeaderTitle: "AI Document Editor",
          }}
        />
        <DocumentEditor />
      </div>
    </CopilotKit>
  );
}

function DocumentEditor() {
  const [document, setDocument] = useState("");
  const [placeholderVisible, setPlaceholderVisible] = useState(true);
  const [currentDocument, setCurrentDocument] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useShowcaseHooks();
  useShowcaseSuggestions();

  const { agent } = useAgent({
    agentId: "shared-state-streaming",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  const agentState = agent.state as AgentState | undefined;
  const setAgentState = (s: AgentState) => agent.setState(s);
  const isLoading = agent.isRunning;

  const wasRunning = useRef(false);

  useEffect(() => {
    if (isLoading) {
      setCurrentDocument(document);
    }
  }, [isLoading]);

  useEffect(() => {
    if (wasRunning.current && !isLoading) {
      if (agentState?.document) {
        setDocument(agentState.document);
        setCurrentDocument(agentState.document);
      }
    }
    wasRunning.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    if (isLoading && agentState?.document) {
      setDocument(agentState.document);
    }
  }, [agentState?.document]);

  useEffect(() => {
    setPlaceholderVisible(document.length === 0);
    if (!isLoading) {
      setCurrentDocument(document);
      setAgentState({ document });
    }
  }, [document]);

  useHumanInTheLoop(
    {
      agentId: "shared-state-streaming",
      name: "write_document",
      description: "Present the proposed changes to the user for review",
      parameters: z.object({
        document: z
          .string()
          .describe("The full updated document in markdown format"),
      }),
      render({
        args,
        status,
        respond,
      }: {
        args: { document?: string };
        status: string;
        respond?: (result: unknown) => Promise<void>;
      }) {
        if (status === "executing") {
          return (
            <ConfirmChanges
              args={args}
              respond={respond}
              status={status}
              onReject={() => {
                setDocument(currentDocument);
                setAgentState({ document: currentDocument });
              }}
              onConfirm={() => {
                const newDoc = agentState?.document || "";
                setDocument(newDoc);
                setCurrentDocument(newDoc);
                setAgentState({ document: newDoc });
              }}
            />
          );
        }
        return <></>;
      },
    },
    [agentState?.document],
  );

  return (
    <div className="relative min-h-screen w-full p-6">
      {placeholderVisible && (
        <div className="absolute top-10 left-10 pointer-events-none text-gray-400">
          Write whatever you want here...
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="w-full min-h-screen p-4 text-base leading-relaxed border-none outline-none resize-none bg-transparent"
        value={document}
        onChange={(e) => setDocument(e.target.value)}
        readOnly={isLoading}
        placeholder=""
      />
    </div>
  );
}

interface ConfirmChangesProps {
  args: { document?: string };
  respond: ((result: unknown) => Promise<void>) | undefined;
  status: string;
  onReject: () => void;
  onConfirm: () => void;
}

function ConfirmChanges({
  respond,
  status,
  onReject,
  onConfirm,
}: ConfirmChangesProps) {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  return (
    <div
      data-testid="confirm-changes-modal"
      className="bg-white p-6 rounded shadow-lg border border-gray-200 mt-5 mb-5"
    >
      <h2 className="text-lg font-bold mb-4">Confirm Changes</h2>
      <p className="mb-6">Do you want to accept the changes?</p>
      {accepted === null && (
        <div className="flex justify-end space-x-4">
          <button
            data-testid="reject-button"
            className={`bg-gray-200 text-black py-2 px-4 rounded disabled:opacity-50 ${
              status === "executing" ? "cursor-pointer" : "cursor-default"
            }`}
            disabled={status !== "executing"}
            onClick={() => {
              if (respond) {
                setAccepted(false);
                onReject();
                respond({ accepted: false });
              }
            }}
          >
            Reject
          </button>
          <button
            data-testid="confirm-button"
            className={`bg-black text-white py-2 px-4 rounded disabled:opacity-50 ${
              status === "executing" ? "cursor-pointer" : "cursor-default"
            }`}
            disabled={status !== "executing"}
            onClick={() => {
              if (respond) {
                setAccepted(true);
                onConfirm();
                respond({ accepted: true });
              }
            }}
          >
            Confirm
          </button>
        </div>
      )}
      {accepted !== null && (
        <div className="flex justify-end">
          <div
            data-testid="status-display"
            className="mt-4 bg-gray-200 text-black py-2 px-4 rounded inline-block"
          >
            {accepted ? "Accepted" : "Rejected"}
          </div>
        </div>
      )}
    </div>
  );
}
