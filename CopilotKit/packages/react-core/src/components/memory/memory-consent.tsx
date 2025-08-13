import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopilotMessagesContext } from "../../context/copilot-messages-context";
import {
  Message,
  TextMessage,
  Role,
  convertMessagesToGqlInput,
} from "@copilotkit/runtime-client-gql";
import { isMemoryUpdateMessage, MemoryUpdateMessage } from "../../types";
import { UsageBanner } from "../usage-banner";
import { Severity } from "@copilotkit/shared";
import { useCopilotContext } from "../../context/copilot-context";

type MemoryConsentProps = {
  enabled?: boolean;
  onAccept?: (update: MemoryUpdateMessage) => void;
  onReject?: (update: MemoryUpdateMessage) => void;
};

function tryGetMemoryUpdateFromMessage(message: Message): MemoryUpdateMessage | null {
  if (!message?.isTextMessage?.() || typeof (message as any).content !== "string") return null;
  const text = (message as any).content as string;
  try {
    const obj = JSON.parse(text);
    return isMemoryUpdateMessage(obj) ? obj : null;
  } catch {
    return null;
  }
}

export function MemoryConsent({ enabled = true, onAccept, onReject }: MemoryConsentProps) {
  const { messages } = useCopilotMessagesContext();
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [current, setCurrent] = useState<MemoryUpdateMessage | null>(null);
  const { runtimeClient, copilotApiConfig } = useCopilotContext();

  const latestUpdate = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const update = tryGetMemoryUpdateFromMessage(m);
      if (!update) continue;
      const id = `${update.fact_key}:${update.createdAt ?? (m as any).id ?? i}`;
      if (!seenIdsRef.current.has(id)) {
        seenIdsRef.current.add(id);
        return update;
      }
    }
    return null;
  }, [messages]);

  // Define callbacks BEFORE any early returns to keep hook order stable
  const callTool = useCallback(
    async (toolName: "memory_upsert" | "memory_delete", args: Record<string, any>) => {
      const system = new TextMessage({
        role: Role.System,
        content:
          "You are a tool router. Call the specified function with the provided JSON args and do not add additional content.",
      });
      const user = new TextMessage({
        role: Role.User,
        content: JSON.stringify({ tool: toolName, args }),
      });

      await runtimeClient
        .generateCopilotResponse({
          data: {
            frontend: {
              actions: [],
              url: typeof window !== "undefined" ? window.location.href : "",
            },
            messages: convertMessagesToGqlInput([system, user] as unknown as Message[]),
            metadata: { requestType: 0 as any },
            forwardedParameters: {
              toolChoice: "function",
              toolChoiceFunctionName: toolName,
            },
          },
          properties: copilotApiConfig.properties,
        })
        .toPromise();
    },
    [runtimeClient, copilotApiConfig.properties],
  );

  useEffect(() => {
    if (!enabled) return;
    if (latestUpdate) setCurrent(latestUpdate);

    // Listen for global memory_update events (emitted by useChat)
    function listener(e: any) {
      const u = e?.detail;
      if (u && isMemoryUpdateMessage(u)) setCurrent(u);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("copilotkit:memory_update", listener as any);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("copilotkit:memory_update", listener as any);
      }
    };
  }, [enabled, latestUpdate]);

  if (!enabled || !current) return null;

  const message = (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Memory update</div>
      <div style={{ opacity: 0.85 }}>
        {current.fact_key}: {String(current.new_value)} ({Math.round(current.confidence * 100)}%)
      </div>
    </div>
  );

  return (
    <UsageBanner
      severity={Severity.INFO}
      message={message}
      onClose={() => setCurrent(null)}
      actions={{
        primary: {
          label: "Accept",
          onClick: async () => {
            try {
              if (onAccept) {
                onAccept(current);
              } else {
                await callTool("memory_upsert", {
                  fact_key: current.fact_key,
                  value: current.new_value,
                  confidence: 1,
                  reason: "explicit_user_request",
                });
              }
            } finally {
              setCurrent(null);
            }
          },
        },
        secondary: {
          label: "Discard",
          onClick: async () => {
            try {
              if (onReject) {
                onReject(current);
              } else {
                await callTool("memory_delete", {
                  fact_key: current.fact_key,
                  reason: "explicit_user_request",
                });
              }
            } finally {
              setCurrent(null);
            }
          },
        },
      }}
    />
  );
}
