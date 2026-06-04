import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const showcaseRoot = join(process.cwd(), "showcase", "integrations", "ag2");

function readShowcaseFile(path: string): string {
  return readFileSync(join(showcaseRoot, path), "utf8");
}

test("ag2 main runtime route is an optional catch-all for Threads APIs", () => {
  expect(
    existsSync(join(showcaseRoot, "src/app/api/copilotkit/route.ts")),
  ).toBe(false);
  expect(
    existsSync(
      join(showcaseRoot, "src/app/api/copilotkit/[[...slug]]/route.ts"),
    ),
  ).toBe(true);
});

test("ag2 main runtime route is gated for Intelligence threads", () => {
  const route = readShowcaseFile("src/app/api/copilotkit/[[...slug]]/route.ts");

  expect(route).toContain("CopilotKitIntelligence");
  expect(route).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
  expect(route).toContain("process.env.INTELLIGENCE_API_KEY");
  expect(route).toContain("process.env.INTELLIGENCE_API_URL");
  expect(route).toContain("process.env.INTELLIGENCE_GATEWAY_WS_URL");
  expect(route).toContain('id: "demo-user"');
  expect(route).toContain("licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN");
  expect(route).toContain(": { runner: new InMemoryAgentRunner() }");
  expect(route).toContain("createCopilotEndpoint");
  expect(route).toContain("export const GET = handle(app);");
  expect(route).toContain("export const POST = handle(app);");
  expect(route).toContain("export const PATCH = handle(app);");
  expect(route).toContain("export const DELETE = handle(app);");
  expect(route).not.toContain("copilotRuntimeNextJSAppRouterEndpoint");
});

test("ag2 shared CopilotKit wrapper exposes Threads drawer and REST transport", () => {
  const wrapper = readShowcaseFile(
    "src/components/showcase-copilotkit/showcase-copilotkit.tsx",
  );

  expect(wrapper).toContain("ThreadsDrawer");
  expect(wrapper).toContain("ThreadsPanelGate");
  expect(wrapper).toContain("CopilotChatConfigurationProvider");
  expect(wrapper).toContain("const [threadId, setThreadId]");
  expect(wrapper).toContain("useSingleEndpoint={false}");
  expect(wrapper).toContain("threadId={threadId}");
  expect(wrapper).toContain("hasExplicitThreadId={threadId !== undefined}");
  expect(wrapper).toContain("agentId={agentId}");
});

test("ag2 demos that use the main runtime go through the shared Threads wrapper", () => {
  const demoPages = [
    "src/app/demos/agentic-chat/page.tsx",
    "src/app/demos/frontend-tools/page.tsx",
    "src/app/demos/gen-ui-agent/page.tsx",
    "src/app/demos/shared-state-read/page.tsx",
    "src/app/demos/shared-state-read-write/page.tsx",
    "src/app/demos/tool-rendering/page.tsx",
  ];

  for (const demoPage of demoPages) {
    const page = readShowcaseFile(demoPage);
    expect(page).toContain("ShowcaseCopilotKit");
    expect(page).not.toContain('runtimeUrl="/api/copilotkit"');
  }
});

test("ag2 exposes local Intelligence env documentation", () => {
  const envExample = readShowcaseFile(".env.example");
  const gitignore = readShowcaseFile(".gitignore");

  expect(envExample).toContain("OPENAI_API_KEY=");
  expect(envExample).toContain("COPILOTKIT_LICENSE_TOKEN=");
  expect(envExample).toContain("INTELLIGENCE_API_KEY=");
  expect(envExample).toContain("INTELLIGENCE_API_URL=http://localhost:4201");
  expect(envExample).toContain(
    "INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401",
  );
  expect(gitignore).toContain("!.env.example");
});

test("ag2 package is pinned to the Intelligence-ready CopilotKit SDK", () => {
  const packageJson = JSON.parse(readShowcaseFile("package.json")) as {
    dependencies: Record<string, string>;
    overrides?: Record<string, string | Record<string, string>>;
    pnpm?: { overrides?: Record<string, string> };
  };

  expect(packageJson.dependencies["@copilotkit/a2ui-renderer"]).toBe("1.59.1");
  expect(packageJson.dependencies["@copilotkit/react-core"]).toBe("1.59.1");
  expect(packageJson.dependencies["@copilotkit/runtime"]).toBe("1.59.1");
  expect(packageJson.dependencies["@copilotkit/shared"]).toBe("1.59.1");
  expect(packageJson.dependencies["@copilotkit/voice"]).toBe("1.59.1");
  expect(packageJson.overrides?.["@copilotkit/web-inspector"]).toEqual({
    "@copilotkit/core": "1.59.1",
  });
  expect(
    packageJson.pnpm?.overrides?.["@copilotkit/web-inspector>@copilotkit/core"],
  ).toBe("1.59.1");
});

test("ag2 Next config enables the Threads feature flag", () => {
  const nextConfig = readShowcaseFile("next.config.ts");

  expect(nextConfig).toContain('output: "standalone"');
  expect(nextConfig).toContain("NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED");
  expect(nextConfig).toContain("process.env.COPILOTKIT_LICENSE_TOKEN");
});
