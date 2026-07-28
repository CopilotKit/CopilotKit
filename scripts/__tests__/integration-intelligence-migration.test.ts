import { describe, expect, it, test } from "vitest";
import { spawnSync } from "node:child_process";
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
  "agent-spec",
  "strands-python",
  "crewai-crews",
] as const;
const intelligenceDevStacks = [
  {
    integration: "adk",
    projectName: "copilotkit-intelligence-dev-adk",
    postgresPort: "5482",
    redisPort: "6389",
    appApiPort: "4201",
    gatewayPort: "4401",
  },
  {
    integration: "agno",
    projectName: "copilotkit-intelligence-dev-agno",
    postgresPort: "5483",
    redisPort: "6390",
    appApiPort: "4202",
    gatewayPort: "4402",
  },
  {
    integration: "llamaindex",
    projectName: "copilotkit-intelligence-dev-llamaindex",
    postgresPort: "5484",
    redisPort: "6391",
    appApiPort: "4203",
    gatewayPort: "4403",
  },
  {
    integration: "mastra",
    projectName: "copilotkit-intelligence-dev-mastra",
    postgresPort: "5485",
    redisPort: "6392",
    appApiPort: "4204",
    gatewayPort: "4404",
  },
  {
    integration: "ms-agent-framework-python",
    projectName: "copilotkit-intelligence-dev-ms-agent-framework-python",
    postgresPort: "5486",
    redisPort: "6393",
    appApiPort: "4205",
    gatewayPort: "4405",
  },
  {
    integration: "pydantic-ai",
    projectName: "copilotkit-intelligence-dev-pydantic-ai",
    postgresPort: "5487",
    redisPort: "6394",
    appApiPort: "4206",
    gatewayPort: "4406",
  },
  {
    integration: "strands-python",
    projectName: "copilotkit-intelligence-dev-strands-python",
    postgresPort: "5488",
    redisPort: "6395",
    appApiPort: "4207",
    gatewayPort: "4407",
  },
] as const;
const expectedPostgresInitSql = [
  "-- Runs once on the postgres container's first boot (docker-entrypoint-initdb.d).",
  "-- The intelligence composite image's migrations oneshot + app-api connect to",
  "-- intelligence_app; graphile-migrate uses intelligence_app_shadow for its shadow",
  "-- database.",
  "CREATE DATABASE intelligence_app;",
  "CREATE DATABASE intelligence_app_shadow;",
  "",
].join("\n");
const a2aMiddlewareRoot = path.join(integrationsDir, "a2a-middleware");

const appRoots: Record<(typeof migratedIntegrations)[number], string> = {
  "crewai-flows": "src/app",
  llamaindex: "src/app",
  "langgraph-fastapi": "src/app",
  "pydantic-ai": "src/app",
  "mcp-apps": "app",
  "agent-spec": "src/app",
  "strands-python": "src/app",
  "crewai-crews": "src/app",
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

function normalizeIntelligenceComposeForDriftGuard(compose: string): string {
  return compose
    .replace(/^name: .+$/m, "name: <starter-project-name>")
    .replace(
      /\$\{POSTGRES_HOST_PORT:-\d+\}/g,
      "${POSTGRES_HOST_PORT:-<postgres-host-port>}",
    )
    .replace(
      /\$\{REDIS_HOST_PORT:-\d+\}/g,
      "${REDIS_HOST_PORT:-<redis-host-port>}",
    )
    .replace(
      /\$\{APP_API_HOST_PORT:-\d+\}/g,
      "${APP_API_HOST_PORT:-<app-api-host-port>}",
    )
    .replace(
      /\$\{GATEWAY_HOST_PORT:-\d+\}/g,
      "${GATEWAY_HOST_PORT:-<gateway-host-port>}",
    )
    .replace(
      /:[0-9]+ \(api\), :[0-9]+ \(gateway\)/g,
      ":<app-api-host-port> (api), :<gateway-host-port> (gateway)",
    )
    .replace(
      /:[0-9]+$/gm,
      (match) =>
        match === ":5432" || match === ":6379" || match === ":4201" || match === ":4401"
          ? match
          : ":<host-port>",
    );
}

function assertDockerComposeConfigSucceeds(integration: string): void {
  const composePath = path.join(
    integrationsDir,
    integration,
    "docker-compose.intelligence.yml",
  );
  const result = spawnSync(
    "docker",
    ["compose", "-f", composePath, "config", "--quiet"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        `${integration} docker-compose.intelligence.yml failed docker compose config --quiet`,
        result.error ? `error: ${result.error.message}` : undefined,
        result.stdout ? `stdout: ${result.stdout}` : undefined,
        result.stderr ? `stderr: ${result.stderr}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

describe("starter local Intelligence docker stacks", () => {
  for (const stack of intelligenceDevStacks) {
    it(`${stack.integration} has a valid local Intelligence compose stack`, () => {
      const compose = readIntegrationFile(
        stack.integration,
        "docker-compose.intelligence.yml",
      );
      const postgresInit = readIntegrationFile(
        stack.integration,
        "docker/postgres-init/01-create-databases.sql",
      );
      const readme = readIntegrationFile(stack.integration, "README.md");
      const envExample = readOptionalIntegrationFile(
        stack.integration,
        ".env.example",
      );

      assertDockerComposeConfigSucceeds(stack.integration);
      expect(compose).toContain(`name: ${stack.projectName}`);
      expect(compose).toContain(
        `\${POSTGRES_HOST_PORT:-${stack.postgresPort}}:5432`,
      );
      expect(compose).toContain(
        `\${REDIS_HOST_PORT:-${stack.redisPort}}:6379`,
      );
      expect(compose).toContain(
        `\${APP_API_HOST_PORT:-${stack.appApiPort}}:4201`,
      );
      expect(compose).toContain(
        `\${GATEWAY_HOST_PORT:-${stack.gatewayPort}}:4401`,
      );
      expect(compose).toContain(
        "./docker/postgres-init:/docker-entrypoint-initdb.d:ro",
      );
      expect(compose).not.toContain("./docker:/docker-entrypoint-initdb.d");
      expect(compose).toContain("pg_isready -U intelligence -d intelligence_app");
      expect(postgresInit).toBe(expectedPostgresInitSql);
      expect(readme).toContain("## CopilotKit Intelligence & Threads (Optional)");
      expect(readme).toContain("docker-compose.intelligence.yml");
      expect(readme).toContain(
        `INTELLIGENCE_API_URL=http://localhost:${stack.appApiPort}`,
      );
      expect(readme).toContain(
        `INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:${stack.gatewayPort}`,
      );

      if (envExample) {
        expect(envExample).toContain(
          `INTELLIGENCE_API_URL=http://localhost:${stack.appApiPort}`,
        );
        expect(envExample).toContain(
          `INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:${stack.gatewayPort}`,
        );
      }
    });
  }

  test("local Intelligence compose host defaults do not collide", () => {
    const projectNames = new Set(
      intelligenceDevStacks.map((stack) => stack.projectName),
    );
    const postgresPorts = new Set(
      intelligenceDevStacks.map((stack) => stack.postgresPort),
    );
    const redisPorts = new Set(
      intelligenceDevStacks.map((stack) => stack.redisPort),
    );
    const appApiPorts = new Set(
      intelligenceDevStacks.map((stack) => stack.appApiPort),
    );
    const gatewayPorts = new Set(
      intelligenceDevStacks.map((stack) => stack.gatewayPort),
    );

    expect(projectNames.size).toBe(intelligenceDevStacks.length);
    expect(postgresPorts.size).toBe(intelligenceDevStacks.length);
    expect(redisPorts.size).toBe(intelligenceDevStacks.length);
    expect(appApiPorts.size).toBe(intelligenceDevStacks.length);
    expect(gatewayPorts.size).toBe(intelligenceDevStacks.length);
  });

  test("local Intelligence compose files drift only by declared starter ports and project names", () => {
    const referenceStack = intelligenceDevStacks[0];
    const remainingStacks = intelligenceDevStacks.slice(1);
    const referenceCompose = normalizeIntelligenceComposeForDriftGuard(
      readIntegrationFile(
        referenceStack.integration,
        "docker-compose.intelligence.yml",
      ),
    );

    for (const stack of remainingStacks) {
      const compose = normalizeIntelligenceComposeForDriftGuard(
        readIntegrationFile(
          stack.integration,
          "docker-compose.intelligence.yml",
        ),
      );

      expect(compose).toBe(referenceCompose);
    }
  });
});

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
      const page = readIntegrationFile(
        integration,
        `${appRoots[integration]}/page.tsx`,
      );

      expect(`${layout}\n${page}`).toContain("useSingleEndpoint={false}");
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
        "1.59.3",
      );
      expect(packageJson.dependencies?.["@copilotkit/runtime"]).toBe("1.59.3");
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

  expect(packageJson.dependencies["@copilotkit/react-core"]).toBe("1.59.3");
  expect(packageJson.dependencies["@copilotkit/runtime"]).toBe("1.59.3");
  expect(packageJson.dependencies["lucide-react"]).toBeDefined();
});

test("a2a-middleware Next config enables the Threads feature flag", () => {
  const nextConfig = readA2AMiddlewareFile("next.config.ts");

  expect(nextConfig).toContain('output: "standalone"');
  expect(nextConfig).toContain("NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED");
  expect(nextConfig).toContain("process.env");
  expect(nextConfig).toContain("COPILOTKIT_LICENSE_TOKEN");
});

const a2aA2uiRoot = path.join(integrationsDir, "a2a-a2ui");

function readA2AA2uiFile(pathFromRoot: string): string {
  return fs.readFileSync(path.join(a2aA2uiRoot, pathFromRoot), "utf8");
}

test("a2a-a2ui runtime route is gated for Intelligence threads", () => {
  const route = readA2AA2uiFile("app/api/copilotkit/[[...slug]]/route.tsx");

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
  const page = readA2AA2uiFile("app/page.tsx");

  expect(page).toContain('runtimeUrl="/api/copilotkit"');
  expect(page).toContain('agentId="default"');
  expect(page).toContain("useSingleEndpoint={false}");
  expect(page).toContain("a2ui={{ theme }}");
  expect(page).toContain("const activityRenderers = [a2uiV08Renderer];");
  expect(page).toContain("renderActivityMessages={activityRenderers}");
});

test("a2a-a2ui page wires a threads drawer into the active chat thread", () => {
  const page = readA2AA2uiFile("app/page.tsx");

  expect(page).toContain("ThreadsDrawer");
  expect(page).toContain("ThreadsPanelGate");
  expect(page).toContain("CopilotChatConfigurationProvider");
  expect(page).toContain("const [threadId, setThreadId]");
  expect(page).toContain('agentId="default"');
  expect(page).toContain("threadId={threadId}");
});

test("a2a-a2ui exposes local Intelligence env documentation", () => {
  const envExample = readA2AA2uiFile(".env.example");
  const gitignore = readA2AA2uiFile(".gitignore");

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
  const packageJson = JSON.parse(readA2AA2uiFile("package.json")) as {
    dependencies: Record<string, string>;
  };

  expect(packageJson.dependencies["@copilotkit/a2ui-renderer"]).toBe("1.59.3");
  expect(packageJson.dependencies["@copilotkit/react-core"]).toBe("1.59.3");
  expect(packageJson.dependencies["@copilotkit/runtime"]).toBe("1.59.3");
  expect(packageJson.dependencies["lucide-react"]).toBeDefined();
});

test("a2a-a2ui Next config enables the Threads feature flag", () => {
  const nextConfig = readA2AA2uiFile("next.config.js");

  expect(nextConfig).toContain('output: "standalone"');
  expect(nextConfig).toContain(
    "NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.COPILOTKIT_LICENSE_TOKEN",
  );
});

const agentcoreRoot = path.join(integrationsDir, "agentcore");

function readAgentcoreFile(pathFromRoot: string): string {
  return fs.readFileSync(path.join(agentcoreRoot, pathFromRoot), "utf8");
}

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
      "1.59.3",
    );
    expect(runtimePackageJson.dependencies?.["@copilotkit/runtime"]).toBe(
      "1.59.3",
    );
    expect(runtimePackageJson.dependencies?.["@ag-ui/client"]).toBe("0.0.53");
  });
});
