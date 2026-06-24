"use client";

// DocsLandingNext — the primary backend picker on the docs landing page.
// The hero explains CopilotKit at the product level; this block gives the
// visitor the next concrete action by linking every visible backend docs
// surface from one grid.

import React from "react";
import Link from "next/link";
import { StoredFrameworkHighlight } from "./stored-framework-highlight";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { getDocsMode, getIntegrations } from "@/lib/registry";

const backendDescriptions: Record<string, string> = {
  "built-in-agent": "Use CopilotKit's in-process agent to get started fast.",
  "langgraph-python":
    "Python LangGraph agents with the broadest feature coverage.",
  "langgraph-typescript": "TypeScript LangGraph agents over the AG-UI adapter.",
  "langgraph-fastapi": "Python LangGraph agents exposed through FastAPI.",
  deepagents: "LangChain Deep Agents connected to CopilotKit product UI.",
  "google-adk": "Gemini-powered Google ADK agents connected through AG-UI.",
  mastra: "TypeScript-native agents, tools, memory, and workflows.",
  "crewai-crews": "CrewAI crews wired into CopilotKit product interfaces.",
  "pydantic-ai": "Typed Python agents with PydanticAI and CopilotKit UI.",
  agno: "Agno agents with tools, state, and generative UI examples.",
  ag2: "AG2 agents with CopilotKit chat, tools, and HITL flows.",
  llamaindex: "LlamaIndex workflows connected to CopilotKit experiences.",
  strands: "AWS Strands agents with CopilotKit frontend primitives.",
  "strands-typescript": "TypeScript AWS Strands agents over the AG-UI adapter.",
  "ms-agent-python": "Microsoft Agent Framework agents in Python.",
  "ms-agent-dotnet": "Microsoft Agent Framework agents in .NET.",
  "ms-agent-harness-dotnet": "Microsoft Agent Harness on .NET via AG-UI.",
};

function BackendGrid() {
  const integrations = getIntegrations()
    // `docs_mode: hidden` frameworks have no docs page — surfacing them
    // here would link straight to a 404.
    .filter((i) => getDocsMode(i.slug) !== "hidden")
    .slice()
    .sort((a, b) => {
      if (a.slug === "built-in-agent") return -1;
      if (b.slug === "built-in-agent") return 1;
      return compareByDisplayOrder(a.slug, b.slug);
    });

  return (
    <section id="backends" className="not-prose">
      <div className="mb-5 max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--text)] sm:text-2xl">
          Build with any agent backend
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Start with CopilotKit's default agent or open the docs for a partner
          framework.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] sm:gap-3">
        {integrations.map((i) => (
          <Link
            key={i.slug}
            href={i.slug === "built-in-agent" ? "/quickstart" : `/${i.slug}`}
            className="shell-docs-radius-surface group relative flex min-h-[84px] items-start gap-3 overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)]/30 p-3.5 no-underline transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-surface)] sm:min-h-[96px]"
          >
            <span
              aria-hidden="true"
              className="shell-docs-radius-icon flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--accent-dim)] text-[var(--accent)] transition-colors group-hover:bg-[var(--accent-light)]"
            >
              <FrameworkLogo
                slug={i.slug}
                fallbackSrc={i.logo}
                size={17}
                className="text-[var(--accent)]"
              />
            </span>
            <span className="min-w-0 flex-1 sm:pr-2">
              <span className="block text-sm font-semibold leading-snug text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
                {i.name}
              </span>
              <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-[var(--text-muted)]">
                {backendDescriptions[i.slug] ?? i.description}
              </span>
            </span>
            <StoredFrameworkHighlight slug={i.slug} />
          </Link>
        ))}
      </div>
    </section>
  );
}

export function DocsLandingNext() {
  return <BackendGrid />;
}
