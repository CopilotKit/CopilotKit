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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
    <Card size="sm">
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        <CardDescription>
          Load a Harness skill or inspect recent skill activity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {skills.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No skill activity yet. Load a skill by name below.
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
          className="flex gap-2"
        >
          <Input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="skill name"
            spellCheck={false}
            className="min-w-0 flex-1"
            disabled={isRunning}
          />
          <Button
            type="submit"
            disabled={isRunning || draft.trim().length === 0}
            variant="outline"
            size="sm"
          >
            Load
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Routes through Harness `load_skill`.
        </p>
      </CardContent>
    </Card>
  );
}

function SkillRow({ skill }: { skill: ControlRoomSkill }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border bg-background p-2 text-xs leading-snug">
      <Badge variant="outline" className="shrink-0">
        {ACTIVITY_LABEL[skill.lastActivity]}
      </Badge>
      <span className="min-w-0 flex-1 text-foreground">
        <span className="font-semibold">{skill.name}</span>
        {skill.lastDetail ? (
          <span className="ml-2 text-muted-foreground">
            · {skill.lastDetail}
          </span>
        ) : null}
      </span>
      <span className="text-muted-foreground">
        ×{skill.invocations}
      </span>
    </li>
  );
}
