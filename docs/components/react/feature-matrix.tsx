"use client";

import React from "react";

type Framework = {
  name: string;
  slug: string;
};

type Feature = {
  name: string;
  key: string;
};

const frameworks: Framework[] = [
  { name: "Built-in", slug: "built-in-agent" },
  { name: "LangChain", slug: "langgraph" },
  { name: "Deep Agents", slug: "deepagents" },
  { name: "ADK", slug: "adk" },
  { name: "Microsoft", slug: "microsoft-agent-framework" },
  { name: "AWS Strands", slug: "aws-strands" },
  { name: "Mastra", slug: "mastra" },
  { name: "Agno", slug: "agno" },
  { name: "Pydantic AI", slug: "pydantic-ai" },
  { name: "CrewAI Flows", slug: "crewai-flows" },
  { name: "LlamaIndex", slug: "llamaindex" },
  { name: "AG2", slug: "ag2" },
  { name: "Agent Spec", slug: "agent-spec" },
];

const features: Feature[] = [
  { name: "Generative UI", key: "genUI" },
  { name: "Frontend Tools", key: "feTools" },
  { name: "Tool Rendering", key: "toolRendering" },
  { name: "MCP Apps", key: "mcpApps" },
  { name: "A2UI", key: "a2ui" },
  { name: "Shared State", key: "sharedState" },
  { name: "Readables", key: "readables" },
  { name: "Interrupts", key: "interrupts" },
  { name: "State Streaming", key: "stateStreaming" },
];

const matrix: Record<string, Record<string, boolean>> = {
  langgraph: {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: true,
    genUI: true,
    interrupts: true,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  deepagents: {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: true,
    genUI: true,
    interrupts: true,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  adk: {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: false,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  agno: {
    sharedState: false,
    feTools: true,
    readables: false,
    toolRendering: true,
    stateStreaming: false,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  "crewai-flows": {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: false,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  "pydantic-ai": {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: true,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  llamaindex: {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: true,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  mastra: {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: false,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  "agent-spec": {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: false,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  ag2: {
    sharedState: true,
    feTools: true,
    readables: false,
    toolRendering: true,
    stateStreaming: false,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  "microsoft-agent-framework": {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: true,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  "aws-strands": {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: false,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
  "built-in-agent": {
    sharedState: true,
    feTools: true,
    readables: true,
    toolRendering: true,
    stateStreaming: false,
    genUI: true,
    interrupts: false,
    agentAppContext: true,
    mcpApps: true,
    a2ui: true,
  },
};

function Check() {
  return (
    <svg
      className="w-4 h-4 text-fd-primary"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Dash() {
  return (
    <svg
      className="w-3.5 h-3.5 text-fd-muted-foreground/40"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 12H8" />
    </svg>
  );
}

export function FeatureMatrix() {
  return (
    <div className="overflow-x-auto my-8 not-prose rounded-xl border border-fd-border bg-fd-card shadow-lg shadow-fd-primary/5">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-fd-border">
            <th className="text-left py-3.5 px-4 font-semibold text-fd-foreground sticky left-0 bg-fd-muted z-10 whitespace-nowrap min-w-[130px]">
              Feature
            </th>
            {frameworks.map((fw) => (
              <th
                key={fw.slug}
                className="py-3.5 px-3 font-semibold text-fd-foreground/70 text-center text-xs whitespace-nowrap"
              >
                <a
                  href={`/${fw.slug}`}
                  className="hover:text-fd-primary transition-colors no-underline text-inherit"
                >
                  {fw.name}
                </a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((feature, i) => (
            <tr
              key={feature.key}
              className={`transition-colors hover:bg-fd-primary/5 ${
                i < features.length - 1 ? "border-b border-fd-border/50" : ""
              }`}
            >
              <td className="py-3 px-4 font-medium text-fd-foreground sticky left-0 z-10 bg-fd-muted border-r border-fd-border whitespace-nowrap">
                {feature.name}
              </td>
              {frameworks.map((fw) => (
                <td key={fw.slug} className="py-3 px-3 text-center">
                  <span className="inline-flex items-center justify-center">
                    {matrix[fw.slug]?.[feature.key] ? <Check /> : <Dash />}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
