import assert from "node:assert/strict";
import { validateBaseline } from "./contract.mjs";
import { bootstrapSource } from "./lifecycle/railway/bootstrap.mjs";

const host = (key) => `{{service:${key}:host}}`;

/** Pure private configuration builder. Caller supplies approved pins/credential;
 * this function never discovers, logs or stores credentials or approves images. */
export function createTemplate({
  images,
  modelCredential,
  runnerUrl,
  registryActivation,
  baseline,
  imageBootstrapTables = {},
  nativeBootstrapTables = {},
}) {
  for (const key of [
    "postgres",
    "redis",
    "composite",
    "application",
    "strands",
  ])
    assert.match(
      images?.[key] ?? "",
      /^[a-z0-9][a-z0-9./_-]+@sha256:[a-f0-9]{64}$/,
      `Immutable ${key} image required`,
    );
  assert.ok(
    typeof modelCredential === "string" && modelCredential.length > 0,
    "Approved external model credential required",
  );
  const registry = new URL("/registry", runnerUrl);
  assert.ok(
    registry.protocol === "https:" && !registry.username && !registry.password,
  );
  assert.ok(
    registryActivation?.review && registryActivation?.revision,
    "Actual consumer activation review required",
  );
  validateBaseline(baseline);
  const database = "intelligence_app",
    user = "postgres",
    password = "{{run:databasePassword}}";
  const databaseUrl = `postgresql://${user}:${password}@${host("postgres")}:5432/${database}`;
  const apiKey = "{{run:apiKey}}";
  const runtime = {
    port: 3001,
    captureDirectory: "/data/capture",
    captureToken: "{{run:captureToken}}",
    apiUrl: `http://${host("composite")}:4201`,
    gatewayUrl: "{{service:composite:url:intelligence-gateway}}",
    apiKey,
    mcpServers: [],
    scopes: [
      {
        framework: "mastra",
        agentId: "beautiful-chat",
        userId: "{{run:userId}}",
        routes: { rich: `http://${host("mastra")}:3002/rich` },
      },
      {
        framework: "strands-typescript",
        agentId: "beautiful-chat",
        userId: "{{run:userId}}",
        routes: { rich: `http://${host("strands")}:8000/beautiful-chat` },
      },
    ],
  };
  const scope = () => ({
    agentId: "beautiful-chat",
    userId: "{{run:userId}}",
    organizationId: "{{run:organizationId}}",
    projectId: "{{bootstrap:projectId}}",
    credentials: { apiKey },
    capture: { token: "{{run:captureToken}}" },
    native: {},
  });
  return {
    provider: "railway",
    purpose: "acceptance",
    projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
    controlDirectory: "/data/control",
    recordsFile: "/data/control/records.json",
    registryActivation,
    baseline,
    consumers: ["image-gate", "ruby-promotion", "harness"].map((consumer) => ({
      transport: "https",
      consumer,
      recordsFile: registry.href,
    })),
    bootstrap: {
      afterServiceKey: "composite",
      serviceKey: "postgres",
      scriptPath: "/data/private/bootstrap-self-hosted.sh",
      ...bootstrapSource,
    },
    database: { serviceKey: "postgres", user, password, database },
    bootstrapTables: {
      ...imageBootstrapTables,
      ...Object.fromEntries(
        ["organizations", "product_actors", "projects", "api_keys"].map(
          (name) => [
            `cpki.${name}`,
            {
              count: 1,
              reason:
                "Pinned canonical single-organization localEvaluation bootstrap",
            },
          ],
        ),
      ),
    },
    nativeBootstrapTables,
    scopes: { mastra: scope(), "strands-typescript": scope() },
    services: [
      {
        key: "postgres",
        roles: ["database"],
        image: images.postgres,
        tcpPort: 5432,
        volume: { mountPath: "/bitnami/postgresql" },
        healthchecks: [{ role: "database", kind: "postgres" }],
        env: {
          // Bitnami initialization names plus inspection's libpq aliases.
          POSTGRESQL_DATABASE: database,
          POSTGRESQL_PASSWORD: password,
          POSTGRESQL_POSTGRES_PASSWORD: password,
          POSTGRES_USER: user,
          POSTGRES_DB: database,
          POSTGRES_PASSWORD: password,
          PGPASSWORD: password,
          DATABASE_URL: `postgresql://${user}:${password}@127.0.0.1:5432/${database}`,
          // Railway volumes mount as root; documented non-root-image setting.
          RAILWAY_RUN_UID: "0",
        },
      },
      {
        key: "redis",
        roles: ["cache"],
        image: images.redis,
        volume: { mountPath: "/bitnami/redis" },
        healthchecks: [{ role: "cache", kind: "redis" }],
        env: { REDIS_PASSWORD: "{{run:redisPassword}}", RAILWAY_RUN_UID: "0" },
      },
      {
        key: "composite",
        roles: ["intelligence-api", "intelligence-gateway"],
        image: images.composite,
        healthchecks: [
          { role: "intelligence-api", port: 4201, path: "/api/health" },
          { role: "intelligence-gateway", port: 4401, path: "/health/ready" },
        ],
        env: {
          DATABASE_URL: databaseUrl,
          REDIS_URL: `redis://:{{run:redisPassword}}@${host("redis")}:6379`,
          AUTH_SECRET: "{{run:authSecret}}",
          RUNNER_AUTH_SECRET: "{{run:runnerAuthSecret}}",
          SECRET_KEY_BASE: "{{run:secretKeyBase}}",
          INTELLIGENCE_DEPLOYMENT_MODE: "self_hosted",
          THREAD_COMPACTION_WORKER_ENABLED: "false",
          SKIP_SCHEMA_DUMP: "1",
        },
      },
      {
        key: "mastra",
        framework: "mastra",
        roles: ["native-backend"],
        image: images.application,
        volume: { mountPath: "/data" },
        healthchecks: [{ role: "native-backend", port: 3002, path: "/health" }],
        startCommand:
          "node --import tsx /app/rich-threads/application/mastra-backend.mjs",
        env: {
          PORT: "3002",
          OPENAI_API_KEY: modelCredential,
          RICH_THREADS_MASTRA_SOURCE: "/app/src/mastra/index.ts",
          TSX_TSCONFIG_PATH: "/app/tsconfig.json",
          MASTRA_WORKFLOW_STORAGE_URL: "file:/data/workflow.db",
          MASTRA_WORKING_MEMORY_URL: "file:/data/memory.db",
        },
      },
      {
        key: "strands",
        framework: "strands-typescript",
        roles: ["native-backend"],
        image: images.strands,
        volume: { mountPath: "/data" },
        healthchecks: [{ role: "native-backend", port: 8000, path: "/health" }],
        env: {
          PORT: "8000",
          OPENAI_API_KEY: modelCredential,
          STRANDS_SESSION_DIRECTORY: "/data/sessions",
        },
      },
      {
        key: "runtime",
        roles: ["application-runtime"],
        image: images.application,
        volume: { mountPath: "/data" },
        healthchecks: [
          { role: "application-runtime", port: 3001, path: "/health" },
        ],
        startCommand: "node /app/rich-threads/runtime.mjs",
        env: { RICH_THREADS_RUNTIME_CONFIG_JSON: JSON.stringify(runtime) },
      },
      {
        key: "application",
        roles: ["application"],
        image: images.application,
        healthchecks: [
          { role: "application", port: 3000, path: "/?framework=mastra" },
        ],
        env: { RICH_THREADS_RUNTIME_URL: `http://${host("runtime")}:3001` },
      },
    ],
  };
}
