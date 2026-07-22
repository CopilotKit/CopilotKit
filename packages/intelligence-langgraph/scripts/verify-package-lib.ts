export const NATIVE_HOOK_SIGNATURE =
  "langchain.createMiddleware.wrapModelCall(request, handler) -> createAgent({ middleware: [...] })";

export interface ResolvedCompatibilityVersions {
  readonly langgraph: string;
  readonly langchain: string;
}

type CompatibilityMode = "minimum" | "latest";

const MINIMUM_VERSIONS: ResolvedCompatibilityVersions = {
  langgraph: "1.3.0",
  langchain: "1.4.4",
};

function parseVersion(name: string, version: string): readonly number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version);
  if (!match) throw new Error(`${name}@${version} is not a semantic version`);
  return match.slice(1, 4).map(Number);
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion("resolved dependency", left);
  const rightParts = parseVersion("compatibility boundary", right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function extractNativeRegistrationSnippet(readme: string): string {
  const heading = /^## Native registration\s*$/gmu.exec(readme);
  if (!heading) {
    throw new Error(
      "README Native registration must contain exactly one TypeScript code block",
    );
  }
  const sectionStart = heading.index + heading[0].length;
  const nextHeading = /^## .+$/gmu;
  nextHeading.lastIndex = sectionStart;
  const nextHeadingMatch = nextHeading.exec(readme);
  const section = readme.slice(
    sectionStart,
    nextHeadingMatch?.index ?? readme.length,
  );
  const snippets = [
    ...section.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)\r?\n```/gu),
  ];
  if (snippets.length !== 1 || snippets[0]?.[1] === undefined) {
    throw new Error(
      "README Native registration must contain exactly one TypeScript code block",
    );
  }
  return snippets[0][1];
}

export function assertResolvedCompatibility(
  mode: CompatibilityMode,
  versions: ResolvedCompatibilityVersions,
): void {
  for (const [name, version, minimum] of [
    ["@langchain/langgraph", versions.langgraph, MINIMUM_VERSIONS.langgraph],
    ["langchain", versions.langchain, MINIMUM_VERSIONS.langchain],
  ] as const) {
    parseVersion(name, version);
    if (mode === "minimum" && version !== minimum) {
      throw new Error(
        `Minimum probe must resolve ${name}@${minimum}, received ${version}`,
      );
    }
    if (
      mode === "latest" &&
      (compareVersions(version, minimum) < 0 ||
        compareVersions(version, "2.0.0") >= 0)
    ) {
      throw new Error(
        `Latest probe must resolve ${name} from ${minimum} through below 2.0.0, received ${version}`,
      );
    }
  }
}

export function formatCompatibilityEvidence(
  mode: CompatibilityMode,
  versions: ResolvedCompatibilityVersions,
): string {
  return `${mode}: @langchain/langgraph@${versions.langgraph} langchain@${versions.langchain} native-hook=${NATIVE_HOOK_SIGNATURE} PASS`;
}
