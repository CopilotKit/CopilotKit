import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const integrationsDir = path.join(repoRoot, "examples", "integrations");

const migratedIntegrations = [
  "crewai-flows",
  "llamaindex",
  "pydantic-ai",
] as const;
const agentcoreRoot = path.join(integrationsDir, "agentcore");

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

function readAgentcoreFile(pathFromRoot: string): string {
  return fs.readFileSync(path.join(agentcoreRoot, pathFromRoot), "utf8");
}

describe("batch-2 Intelligence integration migration", () => {
  for (const integration of migratedIntegrations) {
    it(`${integration} has the env-gated Intelligence runtime route`, () => {
      const route = readIntegrationFile(
        integration,
        "src/app/api/copilotkit/[[...slug]]/route.ts",
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
      const layout = readIntegrationFile(integration, "src/app/layout.tsx");

      expect(layout).toContain("useSingleEndpoint={false}");
    });

    it(`${integration} wires the threads drawer into the chat thread context`, () => {
      const page = readIntegrationFile(integration, "src/app/page.tsx");

      expect(page).toContain("ThreadsDrawer");
      expect(page).toContain("ThreadsPanelGate");
      expect(page).toContain("CopilotChatConfigurationProvider");
      expect(page).toContain("threadId");
      expect(page).toContain("onThreadChange={setThreadId}");
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

describe("agentcore Intelligence integration migration", () => {
  it("gates the Hono runtime bridge with CopilotKit Intelligence", () => {
    const runtime = readAgentcoreFile(
      "infra-cdk/lambdas/copilotkit-runtime/src/runtime.ts",
    );

    expect(runtime).toContain("CopilotKitIntelligence");
    expect(runtime).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
    expect(runtime).toContain("process.env.INTELLIGENCE_API_KEY");
    expect(runtime).toContain("process.env.INTELLIGENCE_API_URL");
    expect(runtime).toContain("process.env.INTELLIGENCE_GATEWAY_WS_URL");
    expect(runtime).toContain(
      "licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN",
    );
    expect(runtime).toContain('id: "demo-user"');
    expect(runtime).toContain(": { runner: new AgentCoreRunner() }");
    expect(runtime).toContain('basePath: "/copilotkit"');
  });

  it("forces REST transport and threads context in the Vite frontend", () => {
    const chat = readAgentcoreFile(
      "frontend/src/components/chat/CopilotKit/index.tsx",
    );

    expect(chat).toContain("useSingleEndpoint={false}");
    expect(chat).toContain("ThreadsDrawer");
    expect(chat).toContain("ThreadsPanelGate");
    expect(chat).toContain("CopilotChatConfigurationProvider");
    expect(chat).toContain("const [threadId, setThreadId]");
    expect(chat).toContain("threadId={threadId}");
    expect(chat).toContain("runtimeUrl={runtimeUrl}");
    expect(chat).toContain("headers={headers}");
  });

  it("exposes the client-safe threads enabled gate for Vite", () => {
    const viteConfig = readAgentcoreFile("frontend/vite.config.ts");
    const lockedState = readAgentcoreFile(
      "frontend/src/components/threads-drawer/locked-state.tsx",
    );

    expect(viteConfig).toContain("VITE_COPILOTKIT_THREADS_ENABLED");
    expect(viteConfig).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
    expect(lockedState).toContain(
      "import.meta.env.VITE_COPILOTKIT_THREADS_ENABLED",
    );
  });

  it("documents and wires local Intelligence environment variables", () => {
    const dockerEnv = readAgentcoreFile("docker/.env.example");
    const compose = readAgentcoreFile("docker/docker-compose.yml");

    for (const envName of [
      "COPILOTKIT_LICENSE_TOKEN",
      "INTELLIGENCE_API_KEY",
      "INTELLIGENCE_API_URL",
      "INTELLIGENCE_GATEWAY_WS_URL",
    ]) {
      expect(dockerEnv).toContain(envName);
      expect(compose).toContain(envName);
    }
  });

  it("pins AgentCore frontend and runtime packages to threads-capable versions", () => {
    const frontendPackageJson = JSON.parse(
      readAgentcoreFile("frontend/package.json"),
    ) as { dependencies?: Record<string, string> };
    const runtimePackageJson = JSON.parse(
      readAgentcoreFile("infra-cdk/lambdas/copilotkit-runtime/package.json"),
    ) as { dependencies?: Record<string, string> };

    expect(frontendPackageJson.dependencies?.["@copilotkit/react-core"]).toBe(
      "1.59.1",
    );
    expect(runtimePackageJson.dependencies?.["@copilotkit/runtime"]).toBe(
      "1.59.1",
    );
    expect(runtimePackageJson.dependencies?.["@ag-ui/client"]).toBe("0.0.53");
  });
});
