import { describe, expect, it } from "vitest";
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
