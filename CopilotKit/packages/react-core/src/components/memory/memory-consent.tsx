import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopilotMessagesContext } from "../../context/copilot-messages-context";
import {
  Message,
  TextMessage,
  Role,
  convertMessagesToGqlInput,
  CopilotRequestType,
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
            metadata: { requestType: CopilotRequestType.Task },
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

  const friendly = (() => {
    const rawKey = (current.fact_key || "").toString();
    const key = rawKey.toLowerCase();
    const value = current.new_value;

    // Map of friendly renderers for common facts
    const RENDER: Record<string, (v: any) => string> = {
      preferred_tone: (v) => `Tone preference: ${String(v)}`,
      preferred_communication_tone: (v) => `Tone preference: ${String(v)}`,
      tone: (v) => `Tone preference: ${String(v)}`,
      writing_style: (v) => `Writing style: ${String(v)}`,
      preferred_formality_level: (v) => `Formality: ${String(v)}`,
      language: (v) => `Language: ${String(v)}`,
      timezone: (v) => `Timezone: ${String(v)}`,
      date_format: (v) => `Date format: ${String(v)}`,
      currency: (v) => `Currency: ${String(v)}`,
      units: (v) => `Units: ${String(v)}`,
      theme: (v) => `Theme: ${String(v).charAt(0).toUpperCase()}${String(v).slice(1)}`,
      ui_theme: (v) => `Theme: ${String(v).charAt(0).toUpperCase()}${String(v).slice(1)}`,
      name: (v) => `Name: ${String(v)}`,
      country: (v) => `Country: ${String(v)}`,
      city: (v) => `City: ${String(v)}`,
    };

    if (RENDER[key]) return RENDER[key](value);

    // fallback: prettify snake_case or dot.notation to English
    const prettyKey = rawKey
      .split(/[._-]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
    const prettyValue =
      typeof value === "string"
        ? value
        : typeof value === "number"
          ? String(value)
          : typeof value === "boolean"
            ? value
              ? "Yes"
              : "No"
            : JSON.stringify(value);
    return `${prettyKey}: ${prettyValue}`;
  })();

  const message = (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Memory update</div>
      <div style={{ opacity: 0.85 }}>
        {friendly} ({Math.round(current.confidence * 100)}%)
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
                // Fire banner immediately for great UX regardless of backend path
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("copilotkit:memory_update", { detail: current }),
                  );
                }
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
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("copilotkit:memory_update", {
                      detail: {
                        ...current,
                        old_value: current.new_value,
                        new_value: undefined,
                        event: "fact.deleted",
                      },
                    }),
                  );
                }
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
