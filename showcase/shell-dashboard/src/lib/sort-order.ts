// Column order: matches Coverage tab (1-18), then Baseline-only extras (19-25).
// Slug aliases (langchain↔langgraph, maf↔ms-agent, crewai↔crewai-crews) ensure
// both tabs sort identically regardless of which slug variant is used.
export const sortOrder: Record<string, number> = {
  // Coverage columns (1-18)
  "langgraph-python": 1,
  "langchain-python": 1,
  "langgraph-typescript": 2,
  "langchain-typescript": 2,
  "langgraph-fastapi": 3,
  "langchain-fastapi": 3,
  "google-adk": 4,
  "ms-agent-python": 5,
  "maf-python": 5,
  "ms-agent-dotnet": 6,
  "maf-dotnet": 6,
  strands: 7,
  mastra: 8,
  "crewai-crews": 9,
  crewai: 9,
  "pydantic-ai": 10,
  "claude-sdk-python": 11,
  "claude-sdk-typescript": 12,
  agno: 13,
  ag2: 14,
  llamaindex: 15,
  "spring-ai": 16,
  langroid: 17,
  "built-in-agent": 18,

  // Baseline-only columns (19-25) — order matches Notion view
  "aws-fast-langgraph": 19,
  "aws-fast-strands": 20,
  "deep-agents": 21,
  "oracle-open-agent-spec": 22,
  "openai-agents-sdk": 23,
  n8n: 24,
  cloudflare: 25,
};
