export interface DuplicateRegionSource {
  /** `"<integration-slug>::<demo-id>"` — used only for error messages. */
  demoKey: string;
  /**
   * The demo id on its own (the `<demo-id>` half of `demoKey`). This, NOT
   * `demoKey`, is what the allowlist is keyed by: demo source is ONE shared
   * copy under `frontends/nextjs/src/app/[integration]/demos/<demo-id>/`
   * serving every integration, so a duplicated region is a property of the
   * demo, never of the integration bundling it.
   *
   * Optional so a caller holding only the composite `demoKey` stays valid —
   * `findUnexpectedDuplicateRegions` then derives it via `demoIdFromKey`.
   */
  demoId?: string;
  regionName: string;
  /** Distinct files that open this region. Reported verbatim in errors. */
  files: string[];
  /**
   * TOTAL number of `@region[<name>] … @endregion[<name>]` slices carrying
   * this name across the demo — NOT the number of distinct files.
   *
   * This is the field the guard decides on. Counting distinct FILES let the
   * exact accident the guard exists to catch through: two copy-pasted
   * `@region[x]` blocks in the SAME file give one distinct file, so a
   * files-only guard skipped them entirely and the bundler's collapse loop
   * silently concatenated the two bodies into one snippet — with no
   * allowlist entry required.
   *
   * Optional for callers that genuinely have one slice per file (and for
   * older tests); it then falls back to `files.length`.
   */
  sliceCount?: number;
}

/**
 * Duplicated regions that are INTENTIONAL — a region name that deliberately
 * appears more than once inside one demo so the bundler concatenates the
 * bodies into a single snippet.
 *
 * Keyed `<demo-id>::<region-name>`. It used to be keyed
 * `<slug>::<demo-id>::<region-name>`, which needed one entry per integration:
 * 48 entries that were exactly 20 integrations x 2 regions of the SAME shared
 * source. That made adding integration #21 a hard bundler error on a demo
 * nobody had touched, and made one intentional multi-file region cost 20
 * lines. Since the source is shared, the demo id is the whole truth.
 *
 * Demo ids and region names are both kebab-case single segments, so `::`
 * cannot occur inside either half and the composite key is unambiguous —
 * unlike the old form, which embedded a `::`-containing `demoKey`.
 */
export const ALLOWED_DUPLICATE_REGION_KEYS = new Set([
  "headless-complete::custom-bubbles",
  "open-gen-ui-advanced::sandbox-function-registration",
]);

export function duplicateRegionKey(demoId: string, regionName: string): string {
  return `${demoId}::${regionName}`;
}

/**
 * Derive the demo id from a `"<integration-slug>::<demo-id>"` bundle key.
 * Exported so the bundler and the verifier build `DuplicateRegionSource`
 * identically instead of each slicing the key by hand.
 */
export function demoIdFromKey(demoKey: string): string {
  const separator = demoKey.indexOf("::");
  return separator === -1 ? demoKey : demoKey.slice(separator + "::".length);
}

/**
 * Regions that occur more than once inside a demo without an allowlist entry.
 *
 * The decision is on TOTAL slice count, so both shapes are caught: the same
 * name in two files, and the same name twice in one file.
 */
export function findUnexpectedDuplicateRegions(
  sources: DuplicateRegionSource[],
): DuplicateRegionSource[] {
  return sources.filter(
    (source) =>
      (source.sliceCount ?? source.files.length) > 1 &&
      !ALLOWED_DUPLICATE_REGION_KEYS.has(
        duplicateRegionKey(
          // Tolerate callers that only set `demoKey` (older call sites and
          // tests): derive the id rather than silently failing the guard
          // open on an `undefined` key.
          source.demoId ?? demoIdFromKey(source.demoKey),
          source.regionName,
        ),
      ),
  );
}

/**
 * Human-readable "where does this region come from" clause for an error
 * message. Shared so the bundler's hard error and the verifier's gate word
 * the same finding identically — a same-file duplicate must not be reported
 * as "appears in multiple files".
 */
export function describeDuplicateRegion(source: DuplicateRegionSource): string {
  const slices = source.sliceCount ?? source.files.length;
  if (source.files.length > 1) {
    return `appears in multiple files (${slices} regions): ${source.files.join(", ")}`;
  }
  return `appears ${slices} times in ${source.files[0] ?? "the demo"}`;
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
  "google-antigravity::renderers-react::src/app/demos/declarative-gen-ui/a2ui/renderers.tsx",
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
