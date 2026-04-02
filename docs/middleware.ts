import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// All framework slugs for pattern-based redirects
const FRAMEWORKS = [
  "langgraph",
  "adk",
  "agno",
  "crewai-flows",
  "pydantic-ai",
  "llamaindex",
  "mastra",
  "agent-spec",
  "ag2",
  "microsoft-agent-framework",
  "aws-strands",
  "agentcore",
  "a2a",
  "built-in-agent",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Common redirects for broken links
  const redirects: Record<string, string> = {
    // Old coagents paths
    "/coagents": "/langgraph",
    "/coagents/quickstart": "/langgraph/quickstart",
    "/coagents/guides": "/langgraph/guides",
    "/coagents/shared-state": "/langgraph/shared-state",
    "/coagents/human-in-the-loop": "/langgraph/human-in-the-loop",
    "/coagents/multi-agent-flows": "/langgraph/multi-agent-flows",
    "/coagents/persistence": "/langgraph/persistence",
    "/coagents/advanced": "/langgraph/advanced",
    "/coagents/videos": "/langgraph/videos",
    "/coagents/tutorials": "/langgraph/tutorials",
    "/coagents/concepts": "/langgraph/concepts",
    "/coagents/frontend-actions": "/langgraph/frontend-tools",
    "/coagents/generative-ui": "/langgraph/generative-ui",

    // Common typos and variations
    "/direct-to-llm/guide": "/built-in-agent/guides",
    "/langgraph/guide": "/langgraph/guides",
    "/mastra/guide": "/mastra/guides",
    "/agno/guide": "/agno/guides",
    "/llamaindex/guide": "/llamaindex/guides",
    "/crewai-flows/guide": "/crewai-flows/guides",
    "/ag2/guide": "/ag2/guides",
    "/pydantic-ai/guide": "/pydantic-ai/guides",
    "/adk/guide": "/adk/guides",

    // API reference variations
    "/api": "/reference",
    "/docs/api": "/reference",
    "/api-reference": "/reference",

    // Quickstart variations
    "/getting-started": "/quickstart",
    "/start": "/quickstart",

    // Frontend actions → frontend tools (renamed in restructure)
    "/frontend-actions": "/frontend-tools",

    // Generative UI directory → first page
    "/generative-ui": "/generative-ui/your-components/display-only",
    "/generative-ui/display": "/generative-ui/your-components/display-only",
    "/generative-ui/interactive": "/generative-ui/your-components/interactive",

    // Old root page names → new names
    "/agentic-chat-ui": "/prebuilt-components",
    "/headless": "/custom-look-and-feel/headless-ui",
    "/coding-agent-setup": "/coding-agents",
    "/copilot-suggestions": "/prebuilt-components",
    "/direct-to-llm": "/built-in-agent",
    "/builtin-agent": "/built-in-agent",

    // Contributing paths
    "/contributing/code-contributions/package-linking":
      "/shared/contributing/code-contributions/package-linking",
  };

  // Check for exact matches
  if (redirects[pathname]) {
    return NextResponse.redirect(new URL(redirects[pathname], request.url));
  }

  // Check for pattern-based redirects
  if (pathname.startsWith("/coagents/")) {
    const newPath = pathname.replace("/coagents/", "/langgraph/");
    return NextResponse.redirect(new URL(newPath, request.url));
  }

  // Per-framework pattern redirects (docs restructure 2026-02)
  for (const fw of FRAMEWORKS) {
    const prefix = `/${fw}/`;
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);

    // Renamed pages
    const renames: Record<string, string> = {
      "agentic-chat-ui": "prebuilt-components",
      "use-agent-hook": "programmatic-control",
      "frontend-actions": "frontend-tools",
      "vibe-coding-mcp": "coding-agents",
      // Old generative-ui pages → new locations
      "generative-ui/agentic": "generative-ui/your-components/display-only",
      "generative-ui/backend-tools": "generative-ui/tool-rendering",
      "generative-ui/frontend-tools": "frontend-tools",
      "generative-ui/render-only": "generative-ui/your-components/display-only",
      "generative-ui/tool-based": "generative-ui/tool-rendering",
      // Old custom-look-and-feel pages
      "custom-look-and-feel/bring-your-own-components":
        "custom-look-and-feel/slots",
      "custom-look-and-feel/customize-built-in-ui-components":
        "custom-look-and-feel/slots",
      "custom-look-and-feel/markdown-rendering": "custom-look-and-feel/slots",
    };

    if (renames[rest]) {
      return NextResponse.redirect(
        new URL(`/${fw}/${renames[rest]}`, request.url),
      );
    }

    // Concepts directory → framework root
    if (rest.startsWith("concepts/") || rest === "concepts") {
      return NextResponse.redirect(new URL(`/${fw}`, request.url));
    }

    break; // Only match one framework
  }

  // Handle guide -> guides redirects
  if (pathname.includes("/guide") && !pathname.includes("/guides")) {
    const newPath = pathname.replace("/guide", "/guides");
    return NextResponse.redirect(new URL(newPath, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
