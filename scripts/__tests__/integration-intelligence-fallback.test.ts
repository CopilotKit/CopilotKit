import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vm from "node:vm";
import * as ts from "typescript";
import { expect, test } from "vitest";

const ROUTES = [
  "examples/integrations/a2a-middleware/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/adk/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/agno/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/claude-sdk-python/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/claude-sdk-typescript/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/crewai-flows/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/langgraph-fastapi/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/langgraph-js/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/langgraph-python/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/llamaindex/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/mastra/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/mcp-apps/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/ms-agent-framework-dotnet/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/ms-agent-framework-python/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/pydantic-ai/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/strands-python/src/app/api/copilotkit/[[...slug]]/route.ts",
] as const;

/** Read one integration route from the repository root. */
function readRoute(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

interface RuntimeModeProbe {
  hasIntelligence: boolean;
  hasRunner: boolean;
  intelligenceApiKey: unknown;
  usesInMemoryRunner: boolean;
  usesManagedIntelligence: boolean;
}

/** Return whether a value is a non-null object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Accept arbitrary calls made while a route initializes its agents. */
function universalStubTarget(..._args: unknown[]): undefined {
  return undefined;
}

/** Create a callable, constructable stub for unrelated route dependencies. */
function createUniversalStub(): (...args: unknown[]) => unknown {
  return new Proxy(universalStubTarget, {
    apply: () => createUniversalStub(),
    construct: () => createUniversalStub(),
    get: (_target, property) => {
      if (property === "then") return undefined;
      if (property === Symbol.toPrimitive) return () => "";
      return createUniversalStub();
    },
    set: () => true,
  });
}

/** Create a CommonJS module whose unspecified exports are inert stubs. */
function createStubModule(
  overrides: Record<PropertyKey, unknown> = {},
): object {
  const target: Record<PropertyKey, unknown> = {
    __esModule: true,
    default: createUniversalStub(),
    ...overrides,
  };

  return new Proxy(target, {
    get: (module, property) =>
      Reflect.has(module, property)
        ? Reflect.get(module, property)
        : createUniversalStub(),
  });
}

/**
 * Execute a full integration route with inert dependency adapters.
 *
 * The real route source reads its controlled environment and constructs its
 * Runtime options. Only external modules are stubbed to avoid starting agents,
 * endpoints, or network clients.
 */
function evaluateRuntimeMode(
  source: string,
  configuredApiKey: string | undefined,
): RuntimeModeProbe {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "integration-route.ts",
    reportDiagnostics: true,
  });
  const errors =
    transpiled.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ?? [];
  if (errors.length > 0) {
    throw new Error(
      `Integration route must transpile: ${errors
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        )
        .join("; ")}`,
    );
  }

  const intelligenceSentinel = Object.freeze({ mode: "intelligence" });
  const runnerSentinel = Object.freeze({ mode: "runner" });
  const capturedRuntimeOptions: Array<Record<string, unknown>> = [];
  let intelligenceApiKey: unknown;

  /** Capture the real options assembled by the route. */
  function CopilotRuntime(options: unknown): object {
    if (!isRecord(options)) {
      throw new Error("CopilotRuntime options must be an object");
    }
    capturedRuntimeOptions.push(options);
    return createUniversalStub();
  }

  /** Capture managed client construction without starting a network client. */
  function CopilotKitIntelligence(options: unknown): object {
    intelligenceApiKey = isRecord(options) ? options.apiKey : undefined;
    return intelligenceSentinel;
  }

  /** Mark local runner construction without retaining thread state. */
  function InMemoryAgentRunner(): object {
    return runnerSentinel;
  }

  const runtimeModule = createStubModule({
    CopilotKitIntelligence,
    CopilotRuntime,
    InMemoryAgentRunner,
    createCopilotEndpoint: createUniversalStub(),
  });
  const dependencyModule = createStubModule();

  /** Resolve the Runtime capture module and inert external dependencies. */
  function routeRequire(identifier: string): object {
    return identifier === "@copilotkit/runtime/v2"
      ? runtimeModule
      : dependencyModule;
  }

  const evaluatedModule: { exports: Record<string, unknown> } = { exports: {} };
  vm.runInNewContext(
    transpiled.outputText,
    {
      exports: evaluatedModule.exports,
      module: evaluatedModule,
      process: {
        env: {
          CPK_INTELLIGENCE_API_KEY: configuredApiKey,
        },
      },
      require: routeRequire,
    },
    {
      filename: "integration-route.js",
      timeout: 1_000,
    },
  );
  if (capturedRuntimeOptions.length !== 1) {
    throw new Error(
      `Route must construct one CopilotRuntime; received ${capturedRuntimeOptions.length}`,
    );
  }

  const options = capturedRuntimeOptions[0]!;
  return {
    hasIntelligence: Object.prototype.hasOwnProperty.call(
      options,
      "intelligence",
    ),
    hasRunner: Object.prototype.hasOwnProperty.call(options, "runner"),
    intelligenceApiKey,
    usesInMemoryRunner: options.runner === runnerSentinel,
    usesManagedIntelligence: options.intelligence === intelligenceSentinel,
  };
}

test.each(ROUTES)(
  "%s keeps the no-key starter path on the in-memory runner",
  (route) => {
    const source = readRoute(route);

    expect(evaluateRuntimeMode(source, undefined)).toEqual({
      hasIntelligence: false,
      hasRunner: true,
      intelligenceApiKey: undefined,
      usesInMemoryRunner: true,
      usesManagedIntelligence: false,
    });
    expect(evaluateRuntimeMode(source, " \t ")).toEqual({
      hasIntelligence: false,
      hasRunner: true,
      intelligenceApiKey: undefined,
      usesInMemoryRunner: true,
      usesManagedIntelligence: false,
    });
    expect(evaluateRuntimeMode(source, " managed-test-key ")).toEqual({
      hasIntelligence: true,
      hasRunner: false,
      intelligenceApiKey: "managed-test-key",
      usesInMemoryRunner: false,
      usesManagedIntelligence: true,
    });
  },
);

test("rejects unconditional Intelligence even when the local fallback text remains", () => {
  const source = readRoute(
    "examples/integrations/langgraph-js/src/app/api/copilotkit/[[...slug]]/route.ts",
  );
  const mutatedSource = source.replace(
    "  ...(intelligenceApiKey",
    `  intelligence: new CopilotKitIntelligence({
    apiKey: intelligenceApiKey ?? "",
    apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
    wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
  }),
  ...(intelligenceApiKey`,
  );

  expect(mutatedSource).not.toBe(source);
  const mutatedMode = evaluateRuntimeMode(mutatedSource, undefined);
  expect(mutatedMode).not.toEqual({
    hasIntelligence: false,
    hasRunner: true,
    intelligenceApiKey: undefined,
    usesInMemoryRunner: true,
    usesManagedIntelligence: false,
  });
  expect(mutatedMode).toMatchObject({
    hasIntelligence: true,
    hasRunner: true,
    intelligenceApiKey: "",
    usesInMemoryRunner: true,
    usesManagedIntelligence: true,
  });
});
