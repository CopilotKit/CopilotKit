import type { FrameworkOverviewData } from "./types";
import a2a from "./a2a";
import ag2 from "./ag2";
import agentSpec from "./agent-spec";
import agno from "./agno";
import crewaiCrews from "./crewai-crews";
import deepagents from "./deepagents";
import googleAdk from "./google-adk";
import langgraphPython from "./langgraph-python";
import llamaindex from "./llamaindex";
import mastra from "./mastra";
import msAgentDotnet from "./ms-agent-dotnet";
import pydanticAi from "./pydantic-ai";
import strands from "./strands";

/**
 * Map of canonical framework slug to `FrameworkOverviewData`. Consumers (the
 * `[framework]/[[...slug]]` route, sidebar nav, sitemap) read from this map.
 */
export const frameworkOverviews: Record<string, FrameworkOverviewData> = {
  a2a,
  ag2,
  "agent-spec": agentSpec,
  agno,
  "crewai-crews": crewaiCrews,
  deepagents,
  "google-adk": googleAdk,
  "langgraph-python": langgraphPython,
  // LangGraph variants share the same intro content (legacy /langgraph in
  // docs/ never differentiated python/typescript/fastapi at the landing
  // page). They share the langgraph/ content folder downstream too. Links
  // in the record currently route through /langgraph/... → langgraph-python
  // via SLUG_RENAMES; framework-aware link rewriting is a follow-up.
  "langgraph-typescript": langgraphPython,
  "langgraph-fastapi": langgraphPython,
  llamaindex,
  mastra,
  "ms-agent-dotnet": msAgentDotnet,
  // ms-agent-python shares the microsoft-agent-framework/ content folder
  // with ms-agent-dotnet; intro content is framework-agnostic.
  "ms-agent-python": msAgentDotnet,
  "pydantic-ai": pydanticAi,
  strands,
};

export type FrameworkOverviewSlug = keyof typeof frameworkOverviews;

export type { FrameworkOverviewData } from "./types";
