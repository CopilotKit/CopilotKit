"use client";

import { LayoutGroup } from "motion/react";
import type { Lead } from "@/lib/leads/types";
import {
  techLevelBreakdown,
  toolUsage,
  workshopDemand,
} from "@/lib/leads/derive";
import { HBar } from "./charts/HBar";
import { Donut } from "./charts/Donut";

const WORKSHOP_BAR: Record<string, string> = {
  "Agentic UI (AG-UI)": "bg-violet-500",
  "MCP Apps / Tooling": "bg-sky-500",
  "RAG & Data Chat": "bg-emerald-500",
  "Evaluations & Guardrails": "bg-amber-500",
  "Deploying Agents (prod)": "bg-indigo-500",
  "Not sure yet": "bg-slate-400",
};

const TOOL_BAR: Record<string, string> = {
  CopilotKit: "bg-primary",
  LangChain: "bg-emerald-500",
  LlamaIndex: "bg-rose-500",
  "Vercel AI SDK": "bg-foreground",
  OpenAI: "bg-emerald-600",
  Anthropic: "bg-amber-500",
  "Google Gemini": "bg-sky-500",
  Other: "bg-slate-400",
};

const TECH_STROKE: Record<string, string> = {
  "Non-technical": "stroke-rose-500",
  "Some technical": "stroke-amber-500",
  Developer: "stroke-sky-500",
  "Advanced / expert": "stroke-violet-500",
};

interface DemandViewProps {
  leads: Lead[];
  onPickWorkshop?: (workshop: string) => void;
  onPickTool?: (tool: string) => void;
  onPickTechLevel?: (level: string) => void;
}

export function DemandView({
  leads,
  onPickWorkshop,
  onPickTool,
  onPickTechLevel,
}: DemandViewProps) {
  const ws = workshopDemand(leads);
  const tools = toolUsage(leads);
  const tech = techLevelBreakdown(leads);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Section
        title="Workshop demand"
        subtitle="Which workshop should we run next?"
        className="lg:col-span-7"
      >
        <LayoutGroup id="workshop-demand">
          <HBar
            rows={ws}
            rowClassName={(label) => WORKSHOP_BAR[label] ?? "bg-primary/70"}
            onClickRow={onPickWorkshop}
          />
        </LayoutGroup>
      </Section>

      <Section
        title="Technical level"
        subtitle="Pitch the right depth"
        className="lg:col-span-5"
      >
        <Donut
          rows={tech}
          colorFor={(label) => TECH_STROKE[label] ?? "stroke-foreground"}
        />
        <button
          type="button"
          className="mt-3 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => onPickTechLevel?.("Developer")}
        >
          filter to Developer →
        </button>
      </Section>

      <Section
        title="Tools they're using"
        subtitle="What audience to design content for"
        className="lg:col-span-12"
      >
        <LayoutGroup id="tool-usage">
          <HBar
            rows={tools}
            rowClassName={(label) => TOOL_BAR[label] ?? "bg-foreground"}
            onClickRow={onPickTool}
          />
        </LayoutGroup>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-card p-4 ${className ?? ""}`}
    >
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
