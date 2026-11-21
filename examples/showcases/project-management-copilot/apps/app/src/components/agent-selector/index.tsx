"use client";

import { Check } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AgentId = "langgraph" | "adk" | "mastra";

interface AgentSelectorProps {
  agentId: AgentId;
  onChange: (id: AgentId) => void;
}

const AGENTS: { id: AgentId; label: string; subtitle: string }[] = [
  { id: "langgraph", label: "Cowork", subtitle: "LangGraph" },
  { id: "adk", label: "Dashboard Designer", subtitle: "ADK" },
  // Placeholder entry — no backend wired. Selecting it mints a fresh
  // thread (via App.tsx onAgentChange) and lands in chat-only mode;
  // actually sending a message will fail because no runtime is registered
  // under `mastra`. Kept here so the picker shows a third option for
  // demo/teaser purposes.
  { id: "mastra", label: "Engineering Agent", subtitle: "Mastra" },
];

/**
 * Text-only agent picker styled like the Claude Code model picker. Bare
 * trigger ("Cowork · LangGraph") sits flush against the chat input's
 * disclaimer area; clicking opens an upward menu with each option on its
 * own row + a checkmark on the active row.
 *
 * The menu is portaled into document.body and absolutely positioned from
 * the trigger's getBoundingClientRect(). The example-layout chat panel
 * carries `overflow: hidden` (needed for the glass-card border radius), so
 * an in-tree absolute dropdown would get clipped — portalling escapes the
 * clip without forcing the parent to drop overflow:hidden.
 */
export function AgentSelector({ agentId, onChange }: AgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{
    bottom: number;
    right: number;
  } | null>(null);
  const active = AGENTS.find((a) => a.id === agentId) ?? AGENTS[0];

  // Anchor the menu's bottom-right to the trigger's top-right so it grows
  // upward — matches the Claude Code model picker which sits at the bottom
  // of the chat and opens above. Using useLayoutEffect so the menu paints
  // in the right spot on the first frame.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPos({
      bottom: window.innerHeight - rect.top + 6,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(255, 255, 255, 0.65)";
        }}
        onMouseLeave={(e) => {
          if (!open)
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
        }}
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: 6,
          padding: "4px 8px",
          background: open ? "rgba(255, 255, 255, 0.65)" : "transparent",
          border: 0,
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-primary)",
          cursor: "pointer",
          transition: "background 140ms ease",
        }}
      >
        <span>{active.label}</span>
        <span style={{ color: "var(--text-disabled)" }}>·</span>
        <span style={{ color: "var(--text-disabled)", fontWeight: 400 }}>
          {active.subtitle}
        </span>
      </button>
      {open &&
        menuPos &&
        createPortal(
          <>
            <div
              onClick={() => setOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 40,
              }}
            />
            <div
              style={{
                position: "fixed",
                bottom: menuPos.bottom,
                right: menuPos.right,
                minWidth: 260,
                background: "#ffffff",
                border: "1px solid #dbdbe5",
                borderRadius: 8,
                boxShadow: "0 8px 24px -4px rgba(1, 5, 7, 0.12)",
                padding: 6,
                zIndex: 50,
              }}
            >
              <div
                style={{
                  padding: "4px 10px 6px",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--text-disabled)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Agents
              </div>
              {AGENTS.map((a) => {
                const isActive = a.id === agentId;
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      onChange(a.id);
                      setOpen(false);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: "transparent",
                      border: 0,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "#f7f7f9";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "transparent";
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "baseline",
                        gap: 6,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {a.label}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-disabled)",
                        }}
                      >
                        {a.subtitle}
                      </span>
                    </span>
                    {isActive && (
                      <Check
                        style={{
                          width: 14,
                          height: 14,
                          color: "var(--text-primary)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
