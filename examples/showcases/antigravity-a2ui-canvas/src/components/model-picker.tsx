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
  const { model, setModel, path, setPath, remember } = useModel();
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });
  const [open, setOpen] = useState(false);
  // Set when a mid-chat choice could not be stored, so it never took effect.
  const [unsaved, setUnsaved] = useState(false);
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
    if (isChosen(option)) {
      setOpen(false);
      return;
    }
    if (!inChat) {
      setOpen(false);
      if (option.kind === "model") setModel(option.id);
      else setPath(option.id);
      return;
    }
    // Mid-chat, the choice applies to the new chat the reload starts, so it
    // has to be stored first. If it can't be, keep this chat and say so.
    if (!remember(option.kind, option.id)) {
      setUnsaved(true);
      return;
    }
    window.location.reload();
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
        onClick={() => {
          setUnsaved(false);
          setOpen((value) => !value);
        }}
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
          {unsaved ? (
            <p className="model-menu-note model-menu-error" role="alert">
              This browser won&rsquo;t save the choice, so this chat stays as it
              is. Allow site data for this page to switch.
            </p>
          ) : (
            inChat && (
              <p className="model-menu-note">A new choice starts a new chat.</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
