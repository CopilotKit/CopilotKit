import fs from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const MAF_DOCS_ROOT =
  "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework";

function listMarkdownFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(REPO_ROOT, relativeDirectory);

  return fs
    .readdirSync(absoluteDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        return listMarkdownFiles(relativePath);
      }
      return entry.isFile() && entry.name.endsWith(".mdx")
        ? [relativePath]
        : [];
    })
    .sort();
}

const guardedFiles = [
  "showcase/shell-docs/src/content/docs/auth.mdx",
  ...listMarkdownFiles(MAF_DOCS_ROOT),
  "examples/integrations/ms-agent-framework-dotnet/README.md",
  "examples/integrations/ms-agent-framework-dotnet/agent/Program.cs",
  "examples/integrations/ms-agent-framework-dotnet/agent/ProverbsAgent.csproj",
  "examples/integrations/ms-agent-framework-dotnet/agent/SharedStateAgent.cs",
  "examples/integrations/ms-agent-framework-dotnet/docker-compose.test.yml",
  "examples/integrations/ms-agent-framework-dotnet/docker/Dockerfile.agent",
  "examples/integrations/ms-agent-framework-dotnet/fixtures/default.json",
];

const staleGuidance = [
  /GitHub Models/i,
  /GitHubToken/,
  /models\.inference\.ai\.azure\.com/,
  /models\.github\.ai/,
  /github\.com\/marketplace\/models/,
  /AddAGUI\(/,
  /MapAGUI\(/,
  /Microsoft\.Extensions\.AI\.OpenAI/,
  /AgentThread/,
  /AgentRunResponse/,
  /ag_ui_state/,
] as const;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

test("does not publish retired provider or obsolete .NET API guidance", () => {
  const offenders = guardedFiles.flatMap((relativePath) => {
    const source = read(relativePath);
    return staleGuidance
      .filter((pattern) => pattern.test(source))
      .map((pattern) => `${relativePath}: ${pattern.source}`);
  });

  expect(offenders).toEqual([]);
});

test("uses the current Agent Framework server and OpenAI APIs", () => {
  const quickstart = read(
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/quickstart.mdx",
  );
  const authGuides = [
    read("showcase/shell-docs/src/content/docs/auth.mdx"),
    read(
      "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/auth.mdx",
    ),
  ];
  const starter = read(
    "examples/integrations/ms-agent-framework-dotnet/agent/Program.cs",
  );
  const project = read(
    "examples/integrations/ms-agent-framework-dotnet/agent/ProverbsAgent.csproj",
  );

  for (const authGuide of authGuides) {
    expect(authGuide).toMatch(
      /dotnet user-secrets init\s+dotnet user-secrets set OPENAI_API_KEY "<your-openai-api-key>"/,
    );
  }
  expect(quickstart).toContain(
    'dotnet user-secrets set OPENAI_API_KEY "<your-openai-api-key>"',
  );
  expect(starter).toContain('_configuration["OPENAI_API_KEY"]');
  expect(starter).toContain('_configuration["OPENAI_BASE_URL"]');
  expect(starter).toContain("builder.Services.AddAGUIServer()");
  expect(starter).toContain('app.MapAGUIServer("/"');
  expect(starter).toContain(".AsAIAgent(");
  expect(project).toContain(
    'PackageReference Include="Microsoft.Agents.AI.OpenAI"',
  );
});
