import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const exampleRoot = join(
  process.cwd(),
  "examples",
  "integrations",
  "llamaindex",
);

function readExampleFile(path: string): string {
  return readFileSync(join(exampleRoot, path), "utf8");
}

test("llamaindex runtime route is gated for Intelligence threads", () => {
  const route = readExampleFile("src/app/api/copilotkit/[[...slug]]/route.ts");

  expect(route).toContain("CopilotKitIntelligence");
  expect(route).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
  expect(route).toContain("process.env.INTELLIGENCE_API_KEY");
  expect(route).toContain("process.env.INTELLIGENCE_API_URL");
  expect(route).toContain("process.env.INTELLIGENCE_GATEWAY_WS_URL");
  expect(route).toContain('id: "demo-user"');
  expect(route).toContain("licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN");
  expect(route).toContain(": { runner: new InMemoryAgentRunner() }");
  expect(route).toContain("export const GET = handle(app);");
  expect(route).toContain("export const POST = handle(app);");
  expect(route).toContain("export const PATCH = handle(app);");
  expect(route).toContain("export const DELETE = handle(app);");
});

test("llamaindex layout uses REST transport for Threads APIs", () => {
  const layout = readExampleFile("src/app/layout.tsx");

  expect(layout).toContain('runtimeUrl="/api/copilotkit"');
  expect(layout).toContain('agent="sample_agent"');
  expect(layout).toContain("useSingleEndpoint={false}");
});

test("llamaindex page wires a threads drawer into the active chat thread", () => {
  const page = readExampleFile("src/app/page.tsx");

  expect(page).toContain("ThreadsDrawer");
  expect(page).toContain("ThreadsPanelGate");
  expect(page).toContain("CopilotChatConfigurationProvider");
  expect(page).toContain("const [threadId, setThreadId]");
  expect(page).toContain('agentId="sample_agent"');
  expect(page).toContain("threadId={threadId}");
  expect(page).toContain("useAgent({");
  expect(page).toContain('agentId: "sample_agent"');
  expect(page).not.toContain("clickOutsideToClose");
});

test("llamaindex exposes local Intelligence env documentation", () => {
  const envExample = readExampleFile(".env.example");
  const gitignore = readExampleFile(".gitignore");

  expect(envExample).toContain("OPENAI_API_KEY=");
  expect(envExample).toContain("AGENT_URL=http://127.0.0.1:9000");
  expect(envExample).toContain("COPILOTKIT_LICENSE_TOKEN=");
  expect(envExample).toContain("INTELLIGENCE_API_KEY=");
  expect(envExample).toContain("INTELLIGENCE_API_URL=http://localhost:4201");
  expect(envExample).toContain(
    "INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401",
  );
  expect(gitignore).toContain("!.env.example");
});

test("llamaindex package is pinned to the Intelligence-ready CopilotKit SDK", () => {
  const packageJson = JSON.parse(readExampleFile("package.json")) as {
    dependencies: Record<string, string>;
  };

  expect(packageJson.dependencies["@copilotkit/react-core"]).toBe("1.59.1");
  expect(packageJson.dependencies["@copilotkit/runtime"]).toBe("1.59.1");
  expect(packageJson.dependencies["class-variance-authority"]).toBeDefined();
  expect(packageJson.dependencies["clsx"]).toBeDefined();
  expect(packageJson.dependencies["lucide-react"]).toBeDefined();
  expect(packageJson.dependencies["tailwind-merge"]).toBeDefined();
});

test("llamaindex Next config enables the Threads feature flag", () => {
  const nextConfig = readExampleFile("next.config.ts");

  expect(nextConfig).toContain('output: "standalone"');
  expect(nextConfig).toContain("NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED");
  expect(nextConfig).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
});
