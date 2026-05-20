// Display order for the agentic-backend picker. Replaces the previous
// category-grouped layout — partners explicitly asked us to drop the
// "MOST POPULAR / AGENT FRAMEWORKS / ENTERPRISE / EMERGING" buckets,
// which read as a tier list and worked against the partnership story.
// Both the sidebar dropdown and the docs-landing "Switch backend" grid
// render a single flat list in this order.
//
// Built-in Agent (CopilotKit) is intentionally NOT in this list: the
// sidebar variant pins it at the top as a separate row, and the docs
// landing already renders the page in BIA's "Continue with…" frame.
export const FRAMEWORK_DISPLAY_ORDER: readonly string[] = [
  "langgraph-python",
  "langgraph-typescript",
  "google-adk",
  "strands",
  "mastra",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "pydantic-ai",
  "ms-agent-python",
  "ms-agent-dotnet",
  "langgraph-fastapi",
  "ag2",
  "agno",
  "llamaindex",
  "langroid",
  "spring-ai",
  "crewai-crews",
];

export function compareByDisplayOrder(a: string, b: string): number {
  const ai = FRAMEWORK_DISPLAY_ORDER.indexOf(a);
  const bi = FRAMEWORK_DISPLAY_ORDER.indexOf(b);
  // Slugs not in the list sort to the end, alpha as tiebreak — keeps
  // the picker stable if the registry adds an integration before this
  // list is updated.
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}
