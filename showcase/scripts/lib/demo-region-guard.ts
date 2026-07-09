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
  "claude-sdk-python::headless-complete::custom-bubbles",
  "claude-sdk-python::open-gen-ui-advanced::sandbox-function-registration",
  "claude-sdk-typescript::headless-complete::custom-bubbles",
  "claude-sdk-typescript::open-gen-ui-advanced::sandbox-function-registration",
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
