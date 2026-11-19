"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { UseAgentUpdate, useAgent } from "@copilotkit/react-core/v2";
import { AGENT_ID } from "@/agent";
import { MODELS, modelById } from "@/lib/models";
import { useModel } from "@/lib/use-model";

/**
 * The model chip in the chat input. It takes the place of the input's "+"
 * button, which has nothing to add here (no attachments).
 *
 * Antigravity fixes a conversation's model when it starts, so picking another
 * model mid-chat starts a new chat: the choice is saved and the page reloads
 * on a fresh thread. Before the first message it just switches.
 */
export function ModelPicker() {
  const { model, setModel } = useModel();
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

  // Close on a click outside or on Escape.
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
    if (open) items.current[MODELS.findIndex((m) => m.id === model)]?.focus();
  }, [open, model]);

  const choose = (id: string) => {
    setOpen(false);
    if (id === model) return;
    setModel(id);
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
      items.current[(index + step + MODELS.length) % MODELS.length]?.focus();
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
          aria-label="Model"
          onKeyDown={onMenuKey}
        >
          {MODELS.map((m, i) => (
            <button
              key={m.id}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={m.id === model}
              className="model-item"
              onClick={() => choose(m.id)}
            >
              <span className="model-item-check" aria-hidden>
                {m.id === model && <Check size={14} />}
              </span>
              <span className="model-item-label">{m.label}</span>
              <span className="model-item-note">{m.note}</span>
            </button>
          ))}
          {inChat && (
            <p className="model-menu-note">Another model starts a new chat.</p>
          )}
        </div>
      )}
    </div>
  );
}
