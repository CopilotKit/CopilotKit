"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useAgentContext, useFrontendTool } from "@copilotkit/react-core/v2";
import { CircleAlert, GraduationCap, Loader2 } from "lucide-react";
import type { Skill } from "./learning/types";

/**
 * Published learned skills, delivered to the in-app agent the way the reskin shell
 * delivers Intelligence's: a live CATALOG (name + description) in the agent's
 * context, and a `loadLearnedSkill` tool that fetches the SKILL.md at the
 * moment the agent decides it needs it. Both read Ledgerline's own learning
 * registry (`/api/learning/v1/skills`), where a reviewer publishes a candidate
 * from the Intelligence screens (`POST /skills/:name/approve`).
 *
 * The load card is the visible proof: "Using learned skill: ...".
 */

const POLL_MS = 3000;
const LOADED = "LOADED learned skill ";

export function usePublishedSkills(): Skill[] | null {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  useEffect(() => {
    let stopped = false;
    const read = async () => {
      try {
        const res = await fetch("/api/learning/v1/skills", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const all = (await res.json()) as Skill[];
        if (!stopped) setSkills(all.filter((s) => s.status === "published"));
      } catch {
        // Next poll catches up.
      }
    };
    void read();
    const t = setInterval(() => void read(), POLL_MS);
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return skills;
}

function catalogText(skills: Skill[] | null): string {
  if (skills === null)
    return "The learned-skills registry is loading. Treat learned skills as unavailable for now.";
  if (skills.length === 0) {
    return "No learned skills are published for Ledgerline yet. There is nothing to load; do not call loadLearnedSkill.";
  }
  return JSON.stringify({
    source: "Automatic Learning, published skills for Ledgerline",
    howToUse:
      "When a refusal or the report in front of you matches a skill's description, call loadLearnedSkill with its name before acting, then follow what it returns.",
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      revision: s.revision,
    })),
  });
}

export function LearnedSkillTools() {
  const skills = usePublishedSkills();

  useAgentContext({
    description:
      "Learned skills: procedures Automatic Learning learned from this team's own work in Ledgerline and a reviewer published. Name and description only; load one with loadLearnedSkill.",
    value: catalogText(skills),
  });

  useFrontendTool(
    {
      name: "loadLearnedSkill",
      description:
        "Load the instructions of one published learned skill listed in your context. Call it before following a learned skill. It fails when the skill is not published.",
      parameters: z.object({
        name: z
          .string()
          .describe(
            "The skill name exactly as listed in the learned-skills context.",
          ),
      }),
      handler: async ({ name }) => {
        const res = await fetch(
          `/api/learning/v1/skills/${encodeURIComponent(name)}`,
          { cache: "no-store" },
        );
        const skill = (await res.json().catch(() => ({}))) as Partial<Skill>;
        if (
          !res.ok ||
          skill.status !== "published" ||
          typeof skill.skillMd !== "string"
        ) {
          return JSON.stringify({
            error: "UNAVAILABLE",
            message: `No published learned skill named ${name}.`,
          });
        }
        return `${LOADED}${skill.name} (revision ${skill.revision}). Carry out its steps with your tools now.\n\n${skill.skillMd}`;
      },
      render: ({ args, result }) => (
        <LearnedSkillCard
          name={typeof args?.name === "string" ? args.name : null}
          result={result}
        />
      ),
    },
    [],
  );

  return null;
}

function LearnedSkillCard({
  name,
  result,
}: {
  name: string | null;
  result: unknown;
}) {
  if (typeof result !== "string") {
    return (
      <div className="my-1 inline-flex items-center gap-2 rounded-[10px] border border-hairline bg-surface px-3 py-1.5 text-[12.5px] text-ink-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {name
          ? `Loading learned skill ${name}...`
          : "Loading a learned skill..."}
      </div>
    );
  }
  if (!result.startsWith(LOADED)) {
    return (
      <div className="my-1 inline-flex items-start gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-1.5 text-[0.76rem] text-ink-muted">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>No learned skill loaded{name ? ` (${name})` : ""}.</span>
      </div>
    );
  }
  const revision = /revision (\d+)/.exec(result)?.[1];
  const steps = result
    .split("\n")
    .filter((l) => /^\d+\.\s/.test(l))
    .map((l) => l.replace(/^\d+\.\s/, ""));
  return (
    <div
      data-testid="ledgerline-learned-skill-card"
      className="my-1.5 rounded-[10px] border border-brand/25 bg-brand-soft px-3.5 py-2.5 text-[0.78rem] text-ink"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <GraduationCap className="h-4 w-4 text-brand" />
        <span className="font-semibold">Using learned skill</span>
        <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[0.72rem]">
          {name}
        </code>
        <span className="text-ink-muted">
          revision {revision ?? "1"}, published from Automatic Learning
        </span>
      </div>
      {steps.length > 0 ? (
        <ol className="mt-2 space-y-0.5 border-l-2 border-brand/30 pl-3 text-[0.74rem] text-ink-muted">
          {steps.slice(0, 5).map((s, i) => (
            <li key={i}>
              <span className="mr-1 tabular-nums">{i + 1}.</span>
              {s}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
