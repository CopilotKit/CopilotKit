import type { FrameworkOverviewData } from "./types";
import a2a from "./a2a";
import agentSpec from "./agent-spec";
import claudeSdkPython from "./claude-sdk-python";
import claudeSdkTypescript from "./claude-sdk-typescript";
import googleAdk from "./google-adk";
import langgraphPython from "./langgraph-python";
import strands from "./strands";

/**
 * Map of canonical framework slug to `FrameworkOverviewData`. Consumers (the
 * `[framework]/[[...slug]]` route, sidebar nav, sitemap) read from this map.
 *
 * Only `docs_mode: generated` slugs belong here. The framework root route
 * gates Tier 1 on `overview && docsMode === "generated"`, so a record for an
 * `authored` slug is never read — that slug renders its
 * `integrations/<folder>/index.mdx` instead. Records for `ag2`, `agno`,
 * `crewai-crews`, `deepagents`, `llamaindex`, `mastra`, `ms-agent-dotnet` and
 * `pydantic-ai` used to sit here unreachable, duplicating the authored MDX and
 * drifting from it. Adding one back only makes sense together with flipping
 * that slug to `generated`.
 */
export const frameworkOverviews: Record<string, FrameworkOverviewData> = {
  a2a,
  "agent-spec": agentSpec,
  "claude-sdk-python": claudeSdkPython,
  "claude-sdk-typescript": claudeSdkTypescript,
  "google-adk": googleAdk,
  "langgraph-python": langgraphPython,
  // LangGraph variants share the same intro content (legacy /langgraph in
  // docs/ never differentiated python/typescript/fastapi at the landing
  // page). They share the langgraph/ content folder downstream too. Links
  // in the record currently route through /langgraph/... → langgraph-python
  // via SLUG_RENAMES; framework-aware link rewriting is a follow-up.
  "langgraph-typescript": langgraphPython,
  "langgraph-fastapi": langgraphPython,
  strands,
  // strands-typescript shares the aws-strands/ content folder with the
  // Python strands integration; intro content is framework-agnostic
  // (mirrors how langgraph-typescript reuses langgraphPython above).
  "strands-typescript": strands,
};

export type FrameworkOverviewSlug = keyof typeof frameworkOverviews;

export type { FrameworkOverviewData } from "./types";
