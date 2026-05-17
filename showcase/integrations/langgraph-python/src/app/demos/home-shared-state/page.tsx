"use client";

/**
 * Homepage: Shared State — bare-minimum bidirectional useAgent demo,
 * styled in the experimental "lavender glass" design language.
 *
 * Reuses the `shared_state_read_write` LangGraph backend. The side
 * panel here is the homepage-tier visual: two white-glass cards
 * (agent state JSON + UI view chips) on the lavender background,
 * with a centered "sync" indicator between them. No demo-layout
 * wrapper, no preferences-card, no notes-card — just the minimum
 * to make the two-way state pattern visible.
 *
 * Iframe target for the "Shared State" chip on the homepage dojo.
 */

import { useEffect } from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import "../_experimental-theme/theme.css";

type RWState = {
  preferences?: { tone?: string; language?: string; interests?: string[] };
  notes?: string[];
};

const INITIAL: Required<RWState> = {
  preferences: { tone: "casual", language: "English", interests: [] },
  notes: [],
};

function DemoContent() {
  const { agent } = useAgent({
    agentId: "shared-state-read-write",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  // Defensive read — agent.state may be undefined or partial on first
  // turn before our seed-effect runs.
  const raw = (agent.state as RWState | undefined) ?? {};
  const preferences = raw.preferences ?? INITIAL.preferences;
  const notes = raw.notes ?? INITIAL.notes;
  const state = { preferences, notes };

  useEffect(() => {
    if (!agent.state || !(agent.state as RWState).preferences) {
      agent.setState(INITIAL);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useConfigureSuggestions({
    suggestions: [
      { title: "Set tone to professional", message: "Change my tone preference to professional." },
      { title: "Remember a note", message: "Remember that I prefer code examples over prose." },
      { title: "Switch language", message: "Switch my preferred language to Spanish." },
    ],
    available: "always",
  });

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        gap: 12,
        padding: 12,
      }}
    >
      {/* ─── Side panel: agent state + UI view ──────────────────── */}
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div className="hd-exp-card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span className="hd-exp-eyebrow">Agent state</span>
            <span
              className="hd-exp-eyebrow"
              style={{ color: "var(--xd-accent-deep)" }}
            >
              written by UI
            </span>
          </div>
          <pre
            style={{
              fontFamily: "var(--xd-mono)",
              fontSize: 11,
              lineHeight: 1.55,
              color: "var(--xd-fg)",
              margin: 0,
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          >
            {JSON.stringify(state, null, 2)}
          </pre>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "4px 0",
          }}
        >
          <span
            style={{
              fontSize: 14,
              color: "var(--xd-accent-deep)",
              fontWeight: 600,
            }}
          >
            ↕
          </span>
          <span className="hd-exp-eyebrow">sync</span>
        </div>

        <div className="hd-exp-card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <span className="hd-exp-eyebrow">UI view</span>
            <span
              className="hd-exp-eyebrow"
              style={{ color: "var(--xd-accent-deep)" }}
            >
              read by agent
            </span>
          </div>
          <PrefRow label="Tone" value={state.preferences.tone ?? ""} />
          <PrefRow label="Language" value={state.preferences.language ?? ""} />
          {state.notes.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <span className="hd-exp-eyebrow">Notes</span>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "6px 0 0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {state.notes.map((n, i) => (
                  <li
                    key={i}
                    style={{
                      fontFamily: "var(--xd-sans)",
                      fontSize: 12,
                      color: "var(--xd-fg)",
                      padding: "6px 8px",
                      background: "var(--xd-accent-softer)",
                      borderRadius: 3,
                      fontStyle: "italic",
                    }}
                  >
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </aside>

      {/* ─── Chat ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <CopilotChat agentId="shared-state-read-write" className="h-full" />
      </div>
    </div>
  );
}

function PrefRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "5px 0",
        borderBottom: "1px solid rgba(17, 9, 30, 0.05)",
      }}
    >
      <span className="hd-exp-eyebrow">{label}</span>
      <span
        style={{
          fontFamily: "var(--xd-sans)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--xd-accent-deep)",
          background: "var(--xd-accent-soft)",
          padding: "2px 9px",
          borderRadius: 999,
        }}
      >
        {value || "—"}
      </span>
    </div>
  );
}

export default function HomeSharedStateDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="shared-state-read-write"
      enableInspector={false}
    >
      <div
        className="hd-exp-scope"
        style={{ height: "100vh", width: "100vw", overflow: "hidden" }}
      >
        <DemoContent />
      </div>
    </CopilotKit>
  );
}
