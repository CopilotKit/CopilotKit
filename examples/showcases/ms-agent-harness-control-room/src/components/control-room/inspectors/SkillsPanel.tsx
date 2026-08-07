"use client";

/**
 * Inspector panel for Harness's `AgentSkillsProvider`. Skills aren't
 * togglable in the SDK sense — the provider exposes three tool calls
 * (`load_skill`, `read_skill_resource`, `run_skill_script`) that the agent
 * uses on demand. This panel:
 *
 *   1. Shows every skill the agent has touched this session (derived from
 *      the tool-call history).
 *   2. Lets the operator nudge the agent to load a specific skill by name
 *      via the standard chat-message injection used elsewhere in the left
 *      pane (see `useSendUserMessage`).
 *
 * Native primitive — no wrapper badge.
 */

import { useState } from "react";

import {
  useControlRoomAgentState,
  useSendUserMessage,
} from "@/hooks/use-control-room-state";
import type { ControlRoomSkill } from "@/lib/control-room-types";

const ACTIVITY_LABEL: Record<ControlRoomSkill["lastActivity"], string> = {
  loaded: "loaded",
  resource_read: "read resource",
  script_run: "ran script",
};

export function SkillsPanel() {
  const agentState = useControlRoomAgentState();
  const skills = agentState.skills ?? [];
  const { send, isRunning } = useSendUserMessage();
  const [draft, setDraft] = useState("");

  const askForSkill = (name: string) => {
    if (isRunning) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    void send(`Please load the "${trimmed}" skill.`);
    setDraft("");
  };

  return (
    <div className="cr-card">
      <h3 className="cr-heading mb-2">Skills</h3>
      {skills.length === 0 ? (
        <p
          className="text-[10.5px] uppercase leading-snug tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          No skill activity yet · ask the agent to load one below
        </p>
      ) : (
        <ul className="space-y-1.5">
          {skills.map((skill) => (
            <SkillRow key={skill.name} skill={skill} />
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          askForSkill(draft);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="skill name"
          spellCheck={false}
          className="cr-input min-w-0 flex-1"
          disabled={isRunning}
        />
        <button
          type="submit"
          disabled={isRunning || draft.trim().length === 0}
          className="cr-btn"
          data-variant="ghost"
        >
          Load
        </button>
      </form>
      <p
        className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Routes through Harness `load_skill`
      </p>
    </div>
  );
}

function SkillRow({ skill }: { skill: ControlRoomSkill }) {
  const tone =
    skill.lastActivity === "script_run"
      ? "amber"
      : skill.lastActivity === "resource_read"
        ? "cyan"
        : "emerald";
  return (
    <li className="flex items-start gap-2 text-[11.5px] leading-snug">
      <span className="cr-chip" data-tone={tone}>
        {ACTIVITY_LABEL[skill.lastActivity]}
      </span>
      <span className="flex-1 text-[var(--cr-fg)]">
        <span className="font-semibold">{skill.name}</span>
        {skill.lastDetail ? (
          <span
            className="ml-2 text-[10.5px] text-[var(--cr-muted-2)]"
            style={{ fontFamily: "var(--cr-font-mono)" }}
          >
            · {skill.lastDetail}
          </span>
        ) : null}
      </span>
      <span
        className="text-[10.5px] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        ×{skill.invocations}
      </span>
    </li>
  );
}
