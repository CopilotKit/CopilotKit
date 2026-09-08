export interface MultiFileRegionSource {
  demoKey: string;
  regionName: string;
  files: string[];
}

export const ALLOWED_MULTI_FILE_REGION_KEYS = new Set([
  "ag2::headless-complete::custom-bubbles",
  "ag2::open-gen-ui-advanced::sandbox-function-registration",
  "agno::headless-complete::custom-bubbles",
  "agno::open-gen-ui-advanced::sandbox-function-registration",
  "built-in-agent::headless-complete::custom-bubbles",
  "built-in-agent::open-gen-ui-advanced::sandbox-function-registration",
  "claude-sdk-python::headless-complete::custom-bubbles",
  "claude-sdk-python::open-gen-ui-advanced::sandbox-function-registration",
  "claude-sdk-typescript::headless-complete::custom-bubbles",
  "claude-sdk-typescript::open-gen-ui-advanced::sandbox-function-registration",
  "crewai-conversational-flows::headless-complete::custom-bubbles",
  "crewai-conversational-flows::open-gen-ui-advanced::sandbox-function-registration",
  "crewai-crews::headless-complete::custom-bubbles",
  "crewai-crews::open-gen-ui-advanced::sandbox-function-registration",
  "google-adk::headless-complete::custom-bubbles",
  "google-adk::open-gen-ui-advanced::sandbox-function-registration",
  "langgraph-fastapi::headless-complete::custom-bubbles",
  "langgraph-fastapi::open-gen-ui-advanced::sandbox-function-registration",
  "langgraph-python::headless-complete::custom-bubbles",
  "langgraph-python::open-gen-ui-advanced::sandbox-function-registration",
  "langgraph-typescript::headless-complete::custom-bubbles",
  "langgraph-typescript::open-gen-ui-advanced::sandbox-function-registration",
  "langroid::headless-complete::custom-bubbles",
  "langroid::open-gen-ui-advanced::sandbox-function-registration",
  "llamaindex::headless-complete::custom-bubbles",
  "llamaindex::open-gen-ui-advanced::sandbox-function-registration",
  "mastra::headless-complete::custom-bubbles",
  "mastra::open-gen-ui-advanced::sandbox-function-registration",
  "ms-agent-dotnet::headless-complete::custom-bubbles",
  "ms-agent-dotnet::open-gen-ui-advanced::sandbox-function-registration",
  "ms-agent-harness-dotnet::open-gen-ui-advanced::sandbox-function-registration",
  "ms-agent-python::open-gen-ui-advanced::sandbox-function-registration",
  "pydantic-ai::headless-complete::custom-bubbles",
  "pydantic-ai::open-gen-ui-advanced::sandbox-function-registration",
  "spring-ai::headless-complete::custom-bubbles",
  "spring-ai::open-gen-ui-advanced::sandbox-function-registration",
  "strands::headless-complete::custom-bubbles",
  "strands::open-gen-ui-advanced::sandbox-function-registration",
  "strands-typescript::headless-complete::custom-bubbles",
  "strands-typescript::open-gen-ui-advanced::sandbox-function-registration",
]);

export function multiFileRegionKey(
  demoKey: string,
  regionName: string,
): string {
  return `${demoKey}::${regionName}`;
}

export function findUnexpectedMultiFileRegions(
  sources: MultiFileRegionSource[],
): MultiFileRegionSource[] {
  return sources.filter(
    (source) =>
      source.files.length > 1 &&
      !ALLOWED_MULTI_FILE_REGION_KEYS.has(
        multiFileRegionKey(source.demoKey, source.regionName),
      ),
  );
}

// ---------------------------------------------------------------------------
// Published-snippet guards
//
// A `@region[...]` body is rendered verbatim on a docs page, so a reader is
// expected to be able to read it — and, for a backend tool, copy it. Two
// failure modes have shipped to docs.copilotkit.ai unnoticed, both introduced
// by the marker-hoist sweep (34b6418) that moved region starts above the
// imports: hoisting to the top of a *god-file* makes the published snippet the
// whole file, and any workspace-only import in that file becomes an
// uninstallable line in the guide.
//
// OSS-901: `/mastra/generative-ui/a2ui/fixed-schema` rendered all 432 lines of
// mastra's tools barrel, including `@copilotkit/showcase-shared-tools` — a
// tsconfig path alias to a symlink in this repo, not a package anyone can
// install. An onboarding run stopped there rather than invent an API.
// ---------------------------------------------------------------------------

export interface RegionBodySource {
  demoKey: string;
  regionName: string;
  /** Bundled path of the file the region was extracted from. */
  file: string;
  /** The region body as it will be published. */
  code: string;
}

export interface RegionBodyFinding extends RegionBodySource {
  detail: string;
}

/**
 * Import specifiers that only resolve inside this repo (tsconfig `paths` to a
 * symlinked directory under `showcase/shared/`). They are fine in showcase
 * code and wrong in a published snippet.
 */
const WORKSPACE_ONLY_SPECIFIER_RE = /@copilotkit\/showcase-[a-z0-9-]+/;

/**
 * Ceiling on a published region. Chosen from the corpus: the median region is
 * 28 lines and p90 is 125, so 200 flags the god-file cases without arguing
 * about genuinely long single-purpose files (a 344-line renderers.tsx is the
 * whole point of that page).
 */
export const MAX_REGION_LINES = 200;

export function regionBodyKey(
  slug: string,
  regionName: string,
  file: string,
): string {
  return `${slug}::${regionName}::${file}`;
}

/**
 * Regions already over `MAX_REGION_LINES` when this guard was added. Each is a
 * page rendering more than a reader can follow; the list only shrinks. Do NOT
 * add an entry to make a build pass — split the file the way
 * `mastra/src/mastra/tools/a2ui-generate.ts` and
 * `strands/src/agents/a2ui_generate.py` were split for OSS-901.
 */
export const OVERSIZE_REGION_BASELINE = new Set([
  "ag2::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "ag2::supervisor-delegation-tools::src/agents/subagents.py",
  "agno::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "agno::supervisor-delegation-tools::src/agents/subagents.py",
  "built-in-agent::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "claude-sdk-python::backend-demo-tool-sets::src/agents/agent.py",
  "claude-sdk-python::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "claude-sdk-typescript::backend-tool-execution::src/agent_server.ts",
  "claude-sdk-typescript::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "crewai-conversational-flows::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "crewai-conversational-flows::supervisor-delegation-tools::src/agents/subagents.py",
  "crewai-crews::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "crewai-crews::supervisor-delegation-tools::src/agents/subagents.py",
  "google-adk::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "google-adk::subagent-setup::src/agents/subagents_agent.py",
  "google-adk::supervisor-delegation-tools::src/agents/subagents_agent.py",
  "langgraph-fastapi::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "langgraph-python::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "langgraph-python::supervisor-delegation-tools::src/agents/subagents.py",
  "langgraph-typescript::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "langgraph-typescript::supervisor-delegation-tools::src/agent/subagents.ts",
  "langroid::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "langroid::supervisor-delegation-tools::src/agents/subagents.py",
  "llamaindex::backend-render-operations::src/agents/a2ui_fixed.py",
  "llamaindex::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "llamaindex::supervisor-delegation-tools::src/agents/subagents_agent.py",
  "mastra::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "mastra::supervisor-delegation-tools::src/mastra/tools/subagents.ts",
  "ms-agent-dotnet::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "ms-agent-dotnet::subagent-setup::agent/SubagentsAgent.cs",
  "ms-agent-dotnet::supervisor-delegation-tools::agent/SubagentsAgent.cs",
  "ms-agent-dotnet::weather-tool-backend::agent/Program.cs",
  "ms-agent-harness-dotnet::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "ms-agent-harness-dotnet::subagent-setup::agent/SubagentsAgent.cs",
  "ms-agent-harness-dotnet::supervisor-delegation-tools::agent/SubagentsAgent.cs",
  "ms-agent-python::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "ms-agent-python::supervisor-delegation-tools::src/agents/subagents_agent.py",
  "pydantic-ai::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "pydantic-ai::supervisor-delegation-tools::src/agents/subagents.py",
  "spring-ai::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "spring-ai::state-streaming-middleware::src/main/java/com/copilotkit/showcase/springai/SharedStateStreamingController.java",
  "spring-ai::supervisor-delegation-tools::src/main/java/com/copilotkit/showcase/springai/SubagentsController.java",
  "strands::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "strands::subagent-setup::src/agents/agent.py",
  "strands::supervisor-delegation-tools::src/agents/agent.py",
  "strands::weather-tool-backend::src/agents/agent.py",
  "strands-typescript::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
  "strands-typescript::subagent-setup::src/agent/tools.ts",
]);

/**
 * Regions whose published body imports something only this repo can resolve.
 * There is no baseline: the list was empty once OSS-901 was fixed, and a new
 * one means a docs page just became unfollowable.
 */
export function findWorkspaceOnlyImportRegions(
  sources: RegionBodySource[],
): RegionBodyFinding[] {
  const findings: RegionBodyFinding[] = [];
  for (const source of sources) {
    const match = source.code.match(WORKSPACE_ONLY_SPECIFIER_RE);
    if (!match) continue;
    findings.push({
      ...source,
      detail: `imports "${match[0]}", which resolves only through this repo's tsconfig paths`,
    });
  }
  return findings;
}

export function findOversizeRegions(
  sources: RegionBodySource[],
): RegionBodyFinding[] {
  const findings: RegionBodyFinding[] = [];
  for (const source of sources) {
    const lineCount = source.code.split("\n").length;
    if (lineCount <= MAX_REGION_LINES) continue;
    const slug = source.demoKey.split("::")[0];
    if (
      OVERSIZE_REGION_BASELINE.has(
        regionBodyKey(slug, source.regionName, source.file),
      )
    ) {
      continue;
    }
    findings.push({
      ...source,
      detail: `publishes ${lineCount} lines (limit ${MAX_REGION_LINES}) — the region marker probably sits above unrelated code`,
    });
  }
  return findings;
}
