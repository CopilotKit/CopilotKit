"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { UseAgentUpdate, useAgent } from "@copilotkit/react-core/v2";
import { AGENT_ID } from "@/agent";
import { MODELS, RENDER_PATHS, modelById } from "@/lib/models";
import type { RenderPath } from "@/lib/models";
import { useModel } from "@/lib/use-model";

type Option =
  | { kind: "model"; id: string; label: string; note: string }
  | { kind: "path"; id: RenderPath["id"]; label: string; note: string };

const OPTIONS: Option[] = [
  ...MODELS.map((m) => ({ kind: "model" as const, ...m })),
  ...RENDER_PATHS.map((p) => ({ kind: "path" as const, ...p })),
];

const GROUPS: Record<Option["kind"], string> = {
  model: "Model",
  path: "Drawing",
};

/**
 * The model chip in the chat input, next to the send button. Its menu picks
 * the Gemini model and how the canvas is drawn (Express streaming or the
 * Antigravity agent).
 *
 * A conversation keeps both: Antigravity fixes a conversation's model when it
 * starts, and the two paths keep the canvas differently. So a new choice
 * mid-chat starts a new chat: it is saved and the page reloads on a fresh
 * thread. Before the first message it just switches.
 */
export function ModelPicker() {
  const { model, setModel, path, setPath } = useModel();
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const current = modelById(model);
  const inChat = agent.messages.length > 0;
  const isChosen = (option: Option) =>
    option.kind === "model" ? option.id === model : option.id === path;

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // Focus the chosen model when the menu opens.
  useEffect(() => {
    if (open) items.current[OPTIONS.findIndex((o) => o.id === model)]?.focus();
  }, [open, model]);

  const choose = (option: Option) => {
    setOpen(false);
    if (isChosen(option)) return;
    if (option.kind === "model") setModel(option.id);
    else setPath(option.id);
    if (inChat) window.location.reload();
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.current.findIndex(
      (el) => el === document.activeElement,
    );
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".model-chip")?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items.current[(index + step + OPTIONS.length) % OPTIONS.length]?.focus();
    }
  };

  return (
    <div className="model-picker" ref={root}>
      <button
        type="button"
        className="model-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={agent.isRunning}
        aria-label={`Model: ${current.label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="model-chip-label">{current.short}</span>
        <span className="model-chip-tiny">{current.tiny}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          className="model-menu"
          role="menu"
          aria-label="Model and drawing"
          onKeyDown={onMenuKey}
        >
          {OPTIONS.map((option, i) => (
            <Fragment key={`${option.kind}:${option.id}`}>
              {OPTIONS[i - 1]?.kind !== option.kind && (
                <p className="model-menu-group" role="presentation">
                  {GROUPS[option.kind]}
                </p>
              )}
              <button
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={isChosen(option)}
                className="model-item"
                onClick={() => choose(option)}
              >
                <span className="model-item-check" aria-hidden>
                  {isChosen(option) && <Check size={14} />}
                </span>
                <span className="model-item-label">{option.label}</span>
                <span className="model-item-note">{option.note}</span>
              </button>
            </Fragment>
          ))}
          {inChat && (
            <p className="model-menu-note">A new choice starts a new chat.</p>
          )}
        </div>
      )}
    </div>
  );
}
