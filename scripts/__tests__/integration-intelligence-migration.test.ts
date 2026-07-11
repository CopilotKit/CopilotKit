import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const integrationsDir = path.join(repoRoot, "examples", "integrations");

const MANAGED_API_KEY = "CPK_INTELLIGENCE_API_KEY";
const OPTIONAL_TELEMETRY_ID = "CPK_TELEMETRY_ID";
const LEGACY_API_KEY = "INTELLIGENCE_API_KEY";
const LEGACY_TELEMETRY_ID = "COPILOTKIT_TELEMETRY_ID";
const MANAGED_LICENSE_TOKEN = "COPILOTKIT_LICENSE_TOKEN";

const MANAGED_CLI_FRAMEWORKS = [
  "langgraph-py",
  "langgraph-js",
  "claude-sdk-typescript",
  "claude-sdk-python",
  "flows",
  "mastra",
  "pydantic-ai",
  "llamaindex",
  "agno",
  "adk",
  "aws-strands-py",
  "a2a",
  "microsoft-agent-framework-dotnet",
  "microsoft-agent-framework-py",
  "mcp-apps",
  "agentcore-langgraph",
  "agentcore-strands",
  "a2ui",
  "opengenui",
] as const;

type ManagedCliFramework = (typeof MANAGED_CLI_FRAMEWORKS)[number];

interface ManagedTemplateContract {
  readonly directory: string;
  readonly frameworks: readonly ManagedCliFramework[];
  readonly runtimePath: string;
  readonly gatePath: string;
  readonly envPath: string;
  readonly readmePath: string;
}

const MANAGED_TEMPLATE_CONTRACTS = [
  {
    directory: "langgraph-python",
    frameworks: ["langgraph-py", "a2ui", "opengenui"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "langgraph-js",
    frameworks: ["langgraph-js"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "claude-sdk-typescript",
    frameworks: ["claude-sdk-typescript"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "claude-sdk-python",
    frameworks: ["claude-sdk-python"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "crewai-flows",
    frameworks: ["flows"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "mastra",
    frameworks: ["mastra"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "pydantic-ai",
    frameworks: ["pydantic-ai"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "llamaindex",
    frameworks: ["llamaindex"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "agno",
    frameworks: ["agno"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "adk",
    frameworks: ["adk"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "strands-python",
    frameworks: ["aws-strands-py"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "a2a-middleware",
    frameworks: ["a2a"],
    runtimePath: "app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "ms-agent-framework-dotnet",
    frameworks: ["microsoft-agent-framework-dotnet"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "ms-agent-framework-python",
    frameworks: ["microsoft-agent-framework-py"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "mcp-apps",
    frameworks: ["mcp-apps"],
    runtimePath: "app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "agentcore",
    frameworks: ["agentcore-langgraph", "agentcore-strands"],
    runtimePath: "infra-cdk/lambdas/copilotkit-runtime/src/runtime.ts",
    gatePath: "frontend/vite.config.ts",
    envPath: "docker/.env.example",
    readmePath: "README.md",
  },
] as const satisfies readonly ManagedTemplateContract[];

/**
 * Reads one required managed-template surface from its authoritative path.
 *
 * @param contract - Managed template and its exact surface paths.
 * @param relativePath - Surface path relative to the integration directory.
 * @param surface - Human-readable surface name used in assertion failures.
 * @returns The UTF-8 contents, or an empty string after a missing-file assertion.
 */
function readManagedSurface(
  contract: ManagedTemplateContract,
  relativePath: string,
  surface: string,
): string {
  const filePath = path.join(integrationsDir, contract.directory, relativePath);
  const exists = fs.existsSync(filePath);

  expect(
    exists,
    `${contract.directory} ${surface} must exist at ${relativePath}`,
  ).toBe(true);

  return exists ? fs.readFileSync(filePath, "utf8") : "";
}

/**
 * Matches an environment identifier without matching it inside a longer name.
 *
 * @param identifier - Exact uppercase environment identifier to match.
 * @returns A pattern that excludes surrounding uppercase identifier characters.
 */
function exactEnvIdentifierPattern(identifier: string): RegExp {
  return new RegExp(`(^|[^A-Z0-9_])${identifier}([^A-Z0-9_]|$)`);
}

/**
 * Matches a documented environment assignment, including commented examples.
 *
 * @param identifier - Exact environment identifier expected before `=`.
 * @returns A multiline assignment pattern.
 */
function envAssignmentPattern(identifier: string): RegExp {
  return new RegExp(`^\\s*#?\\s*${identifier}\\s*=`, "m");
}

/**
 * Matches documentation that labels an environment identifier as optional.
 *
 * @param identifier - Environment identifier whose optionality is documented.
 * @returns A proximity pattern allowing a short comment or paragraph.
 */
function optionalEnvDocumentationPattern(identifier: string): RegExp {
  return new RegExp(
    `(?:optional[\\s\\S]{0,240}${identifier}|${identifier}[\\s\\S]{0,240}optional)`,
    "i",
  );
}

/**
 * Returns the Markdown section containing a managed credential marker.
 *
 * This scopes license-copy checks so explicit self-hosted or offline sections
 * elsewhere in the README remain valid.
 *
 * @param markdown - README contents.
 * @param marker - Managed credential identifier used to locate the section.
 * @returns The matching heading section, or only the matching paragraph when
 * no preceding Markdown heading exists.
 */
function markdownSectionContaining(markdown: string, marker: string): string {
  const lines = markdown.split(/\r?\n/);
  const markerLine = lines.findIndex((line) => line.includes(marker));

  if (markerLine < 0) {
    return "";
  }

  let headingLine = -1;
  let headingLevel = 0;

  for (let index = markerLine; index >= 0; index -= 1) {
    const heading = lines[index]?.match(/^(#{1,6})\s+/);
    if (heading) {
      headingLine = index;
      headingLevel = heading[1]?.length ?? 0;
      break;
    }
  }

  if (headingLine < 0) {
    const paragraphs = markdown.split(/\r?\n\s*\r?\n/);
    return paragraphs.find((paragraph) => paragraph.includes(marker)) ?? "";
  }

  let endLine = lines.length;
  for (let index = markerLine + 1; index < lines.length; index += 1) {
    const heading = lines[index]?.match(/^(#{1,6})\s+/);
    if (heading && (heading[1]?.length ?? 0) <= headingLevel) {
      endLine = index;
      break;
    }
  }

  return lines.slice(headingLine, endLine).join("\n");
}

/**
 * Asserts the managed runtime reads only the managed project credential.
 *
 * @param contents - Runtime route or bridge source.
 */
function expectManagedRuntimeContract(contents: string): void {
  expect(contents).toMatch(exactEnvIdentifierPattern(MANAGED_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_TELEMETRY_ID));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
  expect(contents).not.toMatch(/\blicenseToken\s*:/);
}

/**
 * Asserts the browser-safe feature gate follows the managed project credential.
 *
 * @param contents - Next.js or Vite gate configuration source.
 */
function expectManagedGateContract(contents: string): void {
  expect(contents).toMatch(exactEnvIdentifierPattern(MANAGED_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_TELEMETRY_ID));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/**
 * Asserts an env example documents the managed key and optional telemetry ID.
 *
 * @param contents - Managed template environment example contents.
 */
function expectManagedEnvContract(contents: string): void {
  expect(contents).toMatch(envAssignmentPattern(MANAGED_API_KEY));
  expect(contents).toMatch(envAssignmentPattern(OPTIONAL_TELEMETRY_ID));
  expect(contents).toMatch(
    optionalEnvDocumentationPattern(OPTIONAL_TELEMETRY_ID),
  );
  expect(contents).not.toMatch(envAssignmentPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(envAssignmentPattern(LEGACY_TELEMETRY_ID));
  expect(contents).not.toMatch(envAssignmentPattern(MANAGED_LICENSE_TOKEN));
}

/**
 * Asserts a README documents the managed key and optional telemetry identity.
 *
 * @param contents - Managed template README contents.
 */
function expectManagedReadmeContract(contents: string): void {
  expect(contents).toMatch(exactEnvIdentifierPattern(MANAGED_API_KEY));
  expect(contents).toMatch(exactEnvIdentifierPattern(OPTIONAL_TELEMETRY_ID));
  expect(contents).toMatch(
    optionalEnvDocumentationPattern(OPTIONAL_TELEMETRY_ID),
  );
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_TELEMETRY_ID));

  const managedSection = markdownSectionContaining(contents, MANAGED_API_KEY);
  expect(managedSection).not.toContain(MANAGED_LICENSE_TOKEN);
}

test("the 16 managed template directories back all 19 in-repo CLI frameworks", () => {
  const frameworks = MANAGED_TEMPLATE_CONTRACTS.flatMap(
    (contract) => contract.frameworks,
  );

  expect(MANAGED_TEMPLATE_CONTRACTS).toHaveLength(16);
  expect(new Set(frameworks).size).toBe(19);
  expect([...frameworks].sort()).toEqual([...MANAGED_CLI_FRAMEWORKS].sort());
});

for (const contract of MANAGED_TEMPLATE_CONTRACTS) {
  test(`${contract.directory} runtime uses the managed Intelligence API key`, () => {
    const runtime = readManagedSurface(
      contract,
      contract.runtimePath,
      "runtime",
    );

    expectManagedRuntimeContract(runtime);
  });

  test(`${contract.directory} client gate uses the managed Intelligence API key`, () => {
    const gate = readManagedSurface(contract, contract.gatePath, "client gate");

    expectManagedGateContract(gate);
  });

  test(`${contract.directory} env example documents managed Intelligence credentials`, () => {
    const envExample = readManagedSurface(
      contract,
      contract.envPath,
      "env example",
    );

    expectManagedEnvContract(envExample);
  });

  test(`${contract.directory} README documents managed Intelligence credentials`, () => {
    const readme = readManagedSurface(contract, contract.readmePath, "README");

    expectManagedReadmeContract(readme);
  });
}
