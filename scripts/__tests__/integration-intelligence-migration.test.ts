import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INTEGRATIONS_ROOT = path.join(REPO_ROOT, "examples", "integrations");

const MIGRATED_INSTANCES = ["strands-python"] as const;

function readIntegrationFile(instance: string, relativePath: string): string {
  return fs.readFileSync(
    path.join(INTEGRATIONS_ROOT, instance, relativePath),
    "utf8",
  );
}

describe("integration Intelligence/Threads migrations", () => {
  it.each(MIGRATED_INSTANCES)(
    "%s wires the runtime endpoint for Intelligence-backed Threads",
    (instance) => {
      const route = readIntegrationFile(
        instance,
        "src/app/api/copilotkit/[[...slug]]/route.ts",
      );

      expect(route).toContain("CopilotKitIntelligence");
      expect(route).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
      expect(route).toContain(
        "licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN",
      );
      expect(route).toContain("identifyUser");
      expect(route).toContain('id: "demo-user"');
      expect(route).toContain("new InMemoryAgentRunner()");
      expect(route).toMatch(/export const GET = handle\(app\);/);
      expect(route).toMatch(/export const POST = handle\(app\);/);
      expect(route).toMatch(/export const PATCH = handle\(app\);/);
      expect(route).toMatch(/export const DELETE = handle\(app\);/);
    },
  );

  it.each(MIGRATED_INSTANCES)(
    "%s shares the active thread between the drawer, chat, and canvas",
    (instance) => {
      const page = readIntegrationFile(instance, "src/app/page.tsx");

      expect(page).toContain('import { useState } from "react";');
      expect(page).toContain("ThreadsDrawer");
      expect(page).toContain("ThreadsPanelGate");
      expect(page).toContain("CopilotChatConfigurationProvider");
      expect(page).toContain("const [threadId, setThreadId]");
      expect(page).toContain('agentId="default"');
      expect(page).toContain("threadId={threadId}");
      expect(page).toContain("onThreadChange={setThreadId}");
    },
  );

  it.each(MIGRATED_INSTANCES)(
    "%s documents and derives the public Threads UI flag from the license token",
    (instance) => {
      const envExample = readIntegrationFile(instance, ".env.example");
      const nextConfig = readIntegrationFile(instance, "next.config.ts");

      expect(envExample).toContain("COPILOTKIT_LICENSE_TOKEN");
      expect(envExample).toContain("INTELLIGENCE_API_URL");
      expect(envExample).toContain("INTELLIGENCE_GATEWAY_WS_URL");
      expect(envExample).toContain("INTELLIGENCE_API_KEY");
      expect(nextConfig).toContain("NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED");
      expect(nextConfig).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
    },
  );
});
