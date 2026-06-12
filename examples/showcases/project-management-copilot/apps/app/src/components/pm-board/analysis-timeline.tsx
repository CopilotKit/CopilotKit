"use client";

import { useEffect, useState } from "react";
import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { Check, Loader2, X } from "lucide-react";
import { SectionTitle } from "./section-title";

interface AnalysisState {
  step?: string;
  label?: string;
  count?: number;
  focus?: string;
  by_status?: Record<string, number>;
  urgent_count?: number;
  high_count?: number;
  urgent_ids?: string[];
  plan?: string;
}

const KNOWN_STEPS = [
  { key: "reading", label: "Reading issues" },
  { key: "categorizing", label: "Categorizing by status" },
  { key: "identifying_blockers", label: "Identifying blockers" },
  { key: "drafting_plan", label: "Drafting recommendation" },
  { key: "done", label: "Done" },
];

/**
 * Floating shared-state timeline. Renders only while analyze_backlog is
 * streaming. Subscribes to agent.state.analysis — each emit transitions the
 * active step with a small slide-in animation.
 */
export function AnalysisTimeline() {
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: config?.agentId });
  const analysis = (agent.state as { analysis?: AnalysisState } | undefined)
    ?.analysis;

  // Auto-dismiss after a few seconds once we hit "done", but keep visible
  // long enough to read the recommendation.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (analysis?.step) {
      setVisible(true);
      if (analysis.step === "done") {
        const t = window.setTimeout(() => setVisible(false), 8000);
        return () => window.clearTimeout(t);
      }
    }
  }, [analysis?.step]);

  if (!visible || !analysis) return null;

  const activeIdx = KNOWN_STEPS.findIndex((s) => s.key === analysis.step);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 5,
        width: 320,
        background: "rgba(255, 255, 255, 0.65)",
        border: "2px solid #ffffff",
        borderRadius: 8,
        padding: 12,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0px 16px 24px -8px rgba(1, 5, 7, 0.12)",
        animation: "analysisSlideIn 240ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <SectionTitle
        title="Backlog analysis"
        trailing={
          <button
            onClick={() => setVisible(false)}
            aria-label="Close analysis panel"
            style={{
              width: 16,
              height: 16,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: 0,
              borderRadius: 4,
              background: "transparent",
              color: "#838389",
              cursor: "pointer",
            }}
          >
            <X className="h-3 w-3" />
          </button>
        }
      />

      {analysis.focus && (
        <div
          style={{
            fontSize: 11,
            fontStyle: "italic",
            color: "#57575b",
            marginBottom: 8,
            padding: "0 4px",
          }}
        >
          "{analysis.focus}"
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {KNOWN_STEPS.map((s, idx) => {
          const isActive = idx === activeIdx;
          const isComplete = idx < activeIdx || analysis.step === "done";
          const isPending = idx > activeIdx && analysis.step !== "done";

          return (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 6px",
                borderRadius: 4,
                background: isActive ? "rgba(255,255,255,0.7)" : "transparent",
                opacity: isPending ? 0.4 : 1,
                transition: "all 280ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isComplete
                    ? "#189370"
                    : isActive
                      ? "#bec2ff"
                      : "transparent",
                  border: isPending ? "1px solid #dbdbe5" : "0",
                  flex: "0 0 16px",
                }}
              >
                {isComplete ? (
                  <Check
                    className="text-white"
                    style={{ width: 10, height: 10 }}
                    strokeWidth={3}
                  />
                ) : isActive ? (
                  <Loader2
                    className="text-white animate-spin"
                    style={{ width: 10, height: 10 }}
                  />
                ) : null}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  color: isComplete || isActive ? "#010507" : "#838389",
                }}
              >
                {analysis.label && isActive ? analysis.label : s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Live counters */}
      {(analysis.count !== undefined || analysis.by_status) && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid #dbdbe5",
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          {analysis.count !== undefined && (
            <Stat label="issues" value={analysis.count} />
          )}
          {analysis.urgent_count !== undefined && (
            <Stat label="urgent" value={analysis.urgent_count} tone="#fa5f67" />
          )}
          {analysis.high_count !== undefined && (
            <Stat label="high" value={analysis.high_count} tone="#ffac4d" />
          )}
          {analysis.by_status &&
            Object.entries(analysis.by_status).map(([k, v]) => (
              <Stat key={k} label={k} value={v} />
            ))}
        </div>
      )}

      {analysis.step === "done" && analysis.plan && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: "rgba(255,255,255,0.5)",
            borderRadius: 4,
            fontSize: 11,
            color: "#010507",
            whiteSpace: "pre-wrap",
            lineHeight: 1.45,
            fontFamily: "Spline Sans Mono, ui-monospace, monospace",
          }}
        >
          {analysis.plan}
        </div>
      )}

      <style>{`
        @keyframes analysisSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <span
      className="rounded-full px-1.5 py-[1px] inline-flex items-center gap-1"
      style={{
        background: "rgba(255,255,255,0.65)",
        fontSize: 10,
        fontWeight: 500,
        color: tone ?? "#010507",
      }}
    >
      <span style={{ fontWeight: 700 }}>{value}</span>
      <span style={{ color: "#57575b" }}>{label}</span>
    </span>
  );
}
