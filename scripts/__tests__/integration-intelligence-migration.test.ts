import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const exampleRoot = join(process.cwd(), "examples", "integrations", "a2a-a2ui");

function readExampleFile(path: string): string {
  return readFileSync(join(exampleRoot, path), "utf8");
}

test("a2a-a2ui runtime route is gated for Intelligence threads", () => {
  const route = readExampleFile("app/api/copilotkit/[[...slug]]/route.tsx");

  expect(route).toContain("CopilotKitIntelligence");
  expect(route).toContain("class RuntimeA2AAgent extends A2AAgent");
  expect(route).toContain("const isolatedAgent = new A2AAgent");
  expect(route).toContain("isolatedAgent.setMessages(parameters.messages)");
  expect(route).toContain("return isolatedAgent.runAgent(");
  expect(route).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
  expect(route).toContain("process.env.INTELLIGENCE_API_KEY");
  expect(route).toContain("process.env.INTELLIGENCE_API_URL");
  expect(route).toContain("process.env.INTELLIGENCE_GATEWAY_WS_URL");
  expect(route).toContain('id: "demo-user"');
  expect(route).toContain("licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN");
  expect(route).toContain(": { runner: new InMemoryAgentRunner() }");
  expect(route).toContain("a2ui: {}");
  expect(route).toContain("export const GET = handle(app);");
  expect(route).toContain("export const POST = handle(app);");
  expect(route).toContain("export const PATCH = handle(app);");
  expect(route).toContain("export const DELETE = handle(app);");
});

test("a2a-a2ui page uses REST transport for Threads APIs", () => {
  const page = readExampleFile("app/page.tsx");

  expect(page).toContain('runtimeUrl="/api/copilotkit"');
  expect(page).toContain('agentId="default"');
  expect(page).toContain("useSingleEndpoint={false}");
  expect(page).toContain("a2ui={{ theme }}");
  expect(page).toContain("const activityRenderers = [a2uiV08Renderer];");
  expect(page).toContain("renderActivityMessages={activityRenderers}");
});

test("a2a-a2ui page wires a threads drawer into the active chat thread", () => {
  const page = readExampleFile("app/page.tsx");

  expect(page).toContain("ThreadsDrawer");
  expect(page).toContain("ThreadsPanelGate");
  expect(page).toContain("CopilotChatConfigurationProvider");
  expect(page).toContain("const [threadId, setThreadId]");
  expect(page).toContain('agentId="default"');
  expect(page).toContain("threadId={threadId}");
});

test("a2a-a2ui exposes local Intelligence env documentation", () => {
  const envExample = readExampleFile(".env.example");
  const gitignore = readExampleFile(".gitignore");

  expect(envExample).toContain("OPENAI_API_KEY=");
  expect(envExample).toContain("COPILOTKIT_LICENSE_TOKEN=");
  expect(envExample).toContain("INTELLIGENCE_API_KEY=");
  expect(envExample).toContain("INTELLIGENCE_API_URL=http://localhost:4201");
  expect(envExample).toContain(
    "INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401",
  );
  expect(gitignore).toContain("!.env.example");
});

test("a2a-a2ui package is pinned to the Intelligence-ready CopilotKit SDK", () => {
  const packageJson = JSON.parse(readExampleFile("package.json")) as {
    dependencies: Record<string, string>;
  };

  expect(packageJson.dependencies["@copilotkit/a2ui-renderer"]).toBe("1.59.1");
  expect(packageJson.dependencies["@copilotkit/react-core"]).toBe("1.59.1");
  expect(packageJson.dependencies["@copilotkit/runtime"]).toBe("1.59.1");
  expect(packageJson.dependencies["lucide-react"]).toBeDefined();
});

test("a2a-a2ui Next config enables the Threads feature flag", () => {
  const nextConfig = readExampleFile("next.config.js");

  expect(nextConfig).toContain('output: "standalone"');
  expect(nextConfig).toContain(
    "NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.COPILOTKIT_LICENSE_TOKEN",
  );
});
