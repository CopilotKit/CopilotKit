"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CopilotKitProvider,
  EventType,
  HttpAgent,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  GenerativeUISurface,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import { SAMPLES, sampleOperations, sampleSurfaceId } from "./catalog-data";

const RenderErrors = createContext<Record<string, string>>({});

function createSampleAgent(index: number) {
  const surfaceId = sampleSurfaceId(index);
  return new HttpAgent({
    agentId: surfaceId,
    // All surfaces belong to this page's thread; each sample has its own agent history.
    threadId: "docs-standard-catalog",
    url: "/catalog/agent",
    fetch: async (_url, init) => {
      const { threadId, runId } = JSON.parse(String(init.body)) as {
        threadId: string;
        runId: string;
      };
      const events = [
        { type: EventType.RUN_STARTED, threadId, runId },
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `catalog:${surfaceId}`,
          activityType: "generative-ui-surface",
          replace: true,
          content: {
            surfaceId,
            target: surfaceId,
            catalogId: standardUI.id,
            operations: sampleOperations(
              SAMPLES[index],
              surfaceId,
              standardUI.id,
            ),
            status: "ready",
            rejected: [],
          },
        },
        { type: EventType.RUN_FINISHED, threadId, runId },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    },
  });
}

export function CatalogProvider({
  children,
  indices,
}: {
  children: React.ReactNode;
  indices?: number[];
}) {
  const [agents] = useState(() =>
    Object.fromEntries(
      (indices ?? SAMPLES.map((_, index) => index)).map((index) => [
        sampleSurfaceId(index),
        createSampleAgent(index),
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <RenderErrors.Provider value={errors}>
      <CopilotKitProvider
        agents__unsafe_dev_only={agents}
        enableInspector={false}
        generativeUI={{
          ui: standardUI,
          errorBoundary: {
            onError: (info) =>
              setErrors((current) =>
                current[info.surfaceId] === info.error.message
                  ? current
                  : { ...current, [info.surfaceId]: info.error.message },
              ),
          },
        }}
      >
        {children}
      </CopilotKitProvider>
    </RenderErrors.Provider>
  );
}

function LiveSurface({ index }: { index: number }) {
  const surfaceId = sampleSurfaceId(index);
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: surfaceId });
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  const errors = useContext(RenderErrors);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void copilotkit.runAgent({ agent }).catch(() => setFailed(true));
  }, [copilotkit, agent]);

  if (failed || errors[surfaceId])
    return (
      <p role="alert" className="text-sm">
        This example could not render. Its sample code is still available below.
      </p>
    );
  const events = agent.messages.filter(
    (message) => message.role === "user",
  ).length;
  return (
    <div className="min-w-0 space-y-3">
      <GenerativeUISurface
        id={surfaceId}
        autoScroll={false}
        fallback={
          <p className="text-xs text-[var(--text-muted)]">Loading preview…</p>
        }
      />
      {events > 0 && (
        <p role="status" className="text-xs text-[var(--text-muted)]">
          {events} local {events === 1 ? "event" : "events"}
        </p>
      )}
    </div>
  );
}

export function CatalogSurface({ index }: { index: number }) {
  return (
    <div className="min-h-32 min-w-0 p-6">
      <LiveSurface index={index} />
    </div>
  );
}

export function CatalogEventLog({ index }: { index: number }) {
  const { agent } = useAgent({ agentId: sampleSurfaceId(index) });
  const message = agent.messages
    .filter((entry) => entry.role === "user")
    .at(-1);
  if (!message || typeof message.content !== "string") return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-[var(--text-muted)]">
        Last local event
      </p>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs">
        {message.content}
      </pre>
    </div>
  );
}
