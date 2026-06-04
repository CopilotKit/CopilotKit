import { describe, expect, it, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const integrationsDir = path.join(repoRoot, "examples", "integrations");

const migratedIntegrations = [
  "crewai-flows",
  "llamaindex",
  "langgraph-fastapi",
  "pydantic-ai",
  "mcp-apps",
] as const;
const a2aMiddlewareRoot = path.join(integrationsDir, "a2a-middleware");

const appRoots: Record<(typeof migratedIntegrations)[number], string> = {
  "crewai-flows": "src/app",
  llamaindex: "src/app",
  "langgraph-fastapi": "src/app",
  "pydantic-ai": "src/app",
  "mcp-apps": "app",
};

function readIntegrationFile(
  integration: string,
  relativePath: string,
): string {
  return fs.readFileSync(
    path.join(integrationsDir, integration, relativePath),
    "utf8",
  );
}

function readOptionalIntegrationFile(
  integration: string,
  relativePath: string,
): string {
  const filePath = path.join(integrationsDir, integration, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readA2AMiddlewareFile(pathFromRoot: string): string {
  return fs.readFileSync(path.join(a2aMiddlewareRoot, pathFromRoot), "utf8");
}

describe("batch-2 Intelligence integration migration", () => {
  for (const integration of migratedIntegrations) {
    it(`${integration} has the env-gated Intelligence runtime route`, () => {
      const route = readIntegrationFile(
        integration,
        `${appRoots[integration]}/api/copilotkit/[[...slug]]/route.ts`,
      );

      expect(route).toContain("CopilotKitIntelligence");
      expect(route).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
      expect(route).toContain(
        "licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN",
      );
      expect(route).toContain('id: "demo-user"');
      expect(route).toContain("new InMemoryAgentRunner()");
      expect(route).toContain("export const GET = handle(app)");
      expect(route).toContain("export const POST = handle(app)");
      expect(route).toContain("export const PATCH = handle(app)");
      expect(route).toContain("export const DELETE = handle(app)");
    });

    it(`${integration} forces REST transport for thread routes`, () => {
      const layout = readIntegrationFile(
        integration,
        `${appRoots[integration]}/layout.tsx`,
      );

      expect(layout).toContain("useSingleEndpoint={false}");
    });

    it(`${integration} wires the threads drawer into the chat thread context`, () => {
      const page = readIntegrationFile(
        integration,
        `${appRoots[integration]}/page.tsx`,
      );

      expect(page).toContain("ThreadsDrawer");
      expect(page).toContain("ThreadsPanelGate");
      expect(page).toContain("CopilotChatConfigurationProvider");
      expect(page).toContain("threadId");
      expect(page).toContain("onThreadChange={setThreadId}");

      if (integration === "mcp-apps") {
        expect(page).toContain('key={threadId ?? "new-thread"}');
        expect(page).toContain("threadId={threadId}");

        const drawer = readIntegrationFile(
          integration,
          "app/components/threads-drawer/threads-drawer.tsx",
        );
        expect(drawer).toContain("onThreadChange(undefined)");
        expect(drawer).not.toContain("crypto.randomUUID()");
      }
    });

    it(`${integration} exposes the client-safe threads enabled gate`, () => {
      const nextConfig = readIntegrationFile(integration, "next.config.ts");

      expect(nextConfig).toContain("NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED");
      expect(nextConfig).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
    });

    it(`${integration} documents the local Intelligence environment`, () => {
      const envExample = readOptionalIntegrationFile(
        integration,
        ".env.example",
      );

      expect(envExample).toContain("COPILOTKIT_LICENSE_TOKEN");
      expect(envExample).toContain("INTELLIGENCE_API_KEY");
      expect(envExample).toContain("INTELLIGENCE_API_URL");
      expect(envExample).toContain("INTELLIGENCE_GATEWAY_WS_URL");
    });

    it(`${integration} pins CopilotKit packages to the threads-capable release`, () => {
      const packageJson = JSON.parse(
        readIntegrationFile(integration, "package.json"),
      ) as { dependencies?: Record<string, string> };

      expect(packageJson.dependencies?.["@copilotkit/react-core"]).toBe(
        "1.59.1",
      );
      expect(packageJson.dependencies?.["@copilotkit/runtime"]).toBe("1.59.1");
    });
  }
});

test("a2a-middleware runtime route is gated for Intelligence threads", () => {
  const route = readA2AMiddlewareFile(
    "app/api/copilotkit/[[...slug]]/route.ts",
  );

  expect(route).toContain("CopilotKitIntelligence");
  expect(route).toContain(
    "class RuntimeA2AMiddlewareAgent extends A2AMiddlewareAgent",
  );
  expect(route).toContain("const isolatedAgent = new A2AMiddlewareAgent");
  expect(route).toContain("new HttpAgent({");
  expect(route).toContain("isolatedAgent.setMessages(parameters.messages)");
  expect(route).toContain("return isolatedAgent.runAgent(");
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

test("a2a-middleware preserves its three-agent URL configuration", () => {
  const route = readA2AMiddlewareFile(
    "app/api/copilotkit/[[...slug]]/route.ts",
  );

  expect(route).toContain("process.env.RESEARCH_AGENT_URL");
  expect(route).toContain("process.env.ANALYSIS_AGENT_URL");
  expect(route).toContain("process.env.ORCHESTRATOR_URL");
  expect(route).toContain('agentId: "a2a_chat"');
  expect(route).toContain("agentUrls: [researchAgentUrl, analysisAgentUrl]");
  expect(route).toContain("orchestrationAgentUrl: orchestratorUrl");
});

test("a2a-middleware page uses REST transport for Threads APIs", () => {
  const page = readA2AMiddlewareFile("app/page.tsx");

  expect(page).toContain('runtimeUrl="/api/copilotkit"');
  expect(page).toContain("useSingleEndpoint={false}");
  expect(page).toContain('agentId="a2a_chat"');
  expect(page).toContain("ThreadsDrawer");
  expect(page).toContain("ThreadsPanelGate");
  expect(page).toContain("CopilotChatConfigurationProvider");
  expect(page).toContain("const [threadId, setThreadId]");
  expect(page).toContain("threadId={threadId}");
});

test("a2a-middleware chat keeps A2A visualization tools inside the configured chat", () => {
  const chat = readA2AMiddlewareFile("components/chat.tsx");

  expect(chat).toContain("useFrontendTool");
  expect(chat).toContain('name: "send_message_to_a2a_agent"');
  expect(chat).toContain("MessageToA2A");
  expect(chat).toContain("MessageFromA2A");
  expect(chat).not.toContain("<CopilotKit");
});

test("a2a-middleware exposes local Intelligence env documentation", () => {
  const envExample = readA2AMiddlewareFile(".env.example");

  expect(envExample).toContain("GOOGLE_API_KEY=");
  expect(envExample).toContain("OPENAI_API_KEY=");
  expect(envExample).toContain("COPILOTKIT_LICENSE_TOKEN=");
  expect(envExample).toContain("INTELLIGENCE_API_KEY=");
  expect(envExample).toContain("INTELLIGENCE_API_URL=http://localhost:4201");
  expect(envExample).toContain(
    "INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401",
  );
});

test("a2a-middleware package is pinned to the Intelligence-ready CopilotKit SDK", () => {
  const packageJson = JSON.parse(readA2AMiddlewareFile("package.json")) as {
    dependencies: Record<string, string>;
  };

  expect(packageJson.dependencies["@copilotkit/react-core"]).toBe("1.59.1");
  expect(packageJson.dependencies["@copilotkit/runtime"]).toBe("1.59.1");
  expect(packageJson.dependencies["lucide-react"]).toBeDefined();
});

test("a2a-middleware Next config enables the Threads feature flag", () => {
  const nextConfig = readA2AMiddlewareFile("next.config.ts");

  expect(nextConfig).toContain('output: "standalone"');
  expect(nextConfig).toContain("NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED");
  expect(nextConfig).toContain("process.env");
  expect(nextConfig).toContain("COPILOTKIT_LICENSE_TOKEN");
});
