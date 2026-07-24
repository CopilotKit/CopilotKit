import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";

import {
  CopilotIntelligenceRuntime,
  CopilotRuntime,
  CopilotSseRuntime,
} from "../core/runtime";
import { lambdaClient, parseTelemetryIdFromLicense } from "@copilotkit/shared";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { telemetry } from "../telemetry";
import type { RuntimeInstanceCreatedInfo } from "../telemetry/events";
import { handleRunAgent } from "../handlers/handle-run";

const AGENTS = {};
const IDENTIFY_USER = vi
  .fn()
  .mockResolvedValue({ id: "user-1", name: "User One" });

/** Create a real typed Intelligence client without opening a connection. */
function createIntelligenceClient(): CopilotKitIntelligence {
  return new CopilotKitIntelligence({
    apiUrl: "https://api.example.com",
    wsUrl: "wss://ws.example.com",
    apiKey: "cpk-project-key",
  });
}

/**
 * Every runtime construction path creates a telemetry scope. The scope keeps
 * its construction-time identity for all downstream events, including
 * instance_created, copilot_request_created, and agent_execution_*.
 *
 * Regression guard for the gap where only CopilotIntelligenceRuntime used the
 * license token, so self-hosted SSE users never got a telemetry_id.
 */
describe("runtime construction — telemetry license token", () => {
  // Real JWT shape with telemetry_id so the parser doesn't warn.
  const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
    "base64url",
  )}.sig`;

  let createScopeSpy: ReturnType<typeof vi.spyOn>;
  let setLicenseTokenSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Assert constructors create a scope without using the legacy setter.
    createScopeSpy = vi.spyOn(telemetry, "createScope");
    setLicenseTokenSpy = vi.spyOn(telemetry, "setLicenseToken");
    originalEnv = process.env.COPILOTKIT_LICENSE_TOKEN;
    delete process.env.COPILOTKIT_LICENSE_TOKEN;
  });

  afterEach(() => {
    setLicenseTokenSpy.mockRestore();
    createScopeSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.COPILOTKIT_LICENSE_TOKEN;
    } else {
      process.env.COPILOTKIT_LICENSE_TOKEN = originalEnv;
    }
  });

  describe("CopilotSseRuntime (self-hosted, direct)", () => {
    it("forwards an explicit licenseToken option to telemetry", () => {
      const runtime = new CopilotSseRuntime({
        agents: AGENTS,
        licenseToken: TOKEN,
      });

      expect(runtime.mode).toBe("sse");
      expect(createScopeSpy).toHaveBeenCalledTimes(1);
      expect(createScopeSpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });

    it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
      process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

      const runtime = new CopilotSseRuntime({ agents: AGENTS });

      expect(runtime.mode).toBe("sse");
      expect(createScopeSpy).toHaveBeenCalledTimes(1);
      expect(createScopeSpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });

    it("does not set a token when none is provided", () => {
      const runtime = new CopilotSseRuntime({ agents: AGENTS });

      expect(runtime.mode).toBe("sse");
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });
  });

  describe("CopilotRuntime shim — SSE delegate (self-hosted, default entrypoint)", () => {
    it("forwards an explicit licenseToken option to telemetry", () => {
      const runtime = new CopilotRuntime({
        agents: AGENTS,
        licenseToken: TOKEN,
      });

      expect(runtime.mode).toBe("sse");
      expect(createScopeSpy).toHaveBeenCalledTimes(1);
      expect(createScopeSpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });

    it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
      process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

      const runtime = new CopilotRuntime({ agents: AGENTS });

      expect(runtime.mode).toBe("sse");
      expect(createScopeSpy).toHaveBeenCalledTimes(1);
      expect(createScopeSpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });
  });

  describe("CopilotIntelligenceRuntime (direct)", () => {
    it("forwards the licenseToken exactly once (no double-set after hoist)", () => {
      const runtime = new CopilotIntelligenceRuntime({
        agents: AGENTS,
        intelligence: createIntelligenceClient(),
        identifyUser: IDENTIFY_USER,
        licenseToken: TOKEN,
      });

      expect(runtime.mode).toBe("intelligence");
      expect(createScopeSpy).toHaveBeenCalledTimes(1);
      expect(createScopeSpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });

    it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
      process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

      const runtime = new CopilotIntelligenceRuntime({
        agents: AGENTS,
        intelligence: createIntelligenceClient(),
        identifyUser: IDENTIFY_USER,
      });

      expect(runtime.mode).toBe("intelligence");
      expect(createScopeSpy).toHaveBeenCalledTimes(1);
      expect(createScopeSpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });
  });

  describe("CopilotRuntime shim — Intelligence delegate", () => {
    it("forwards the licenseToken exactly once", () => {
      const runtime = new CopilotRuntime({
        agents: AGENTS,
        intelligence: createIntelligenceClient(),
        identifyUser: IDENTIFY_USER,
        licenseToken: TOKEN,
      });

      expect(runtime.mode).toBe("intelligence");
      expect(createScopeSpy).toHaveBeenCalledTimes(1);
      expect(createScopeSpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });
  });
});

interface RuntimeTelemetryIdentityCase {
  label: string;
  telemetryId?: string;
  environmentTelemetryId?: string;
  licenseToken?: string;
  expectedIdentity: {
    telemetryId?: string;
    licenseToken?: string;
  };
}

interface RuntimeConstructorCase {
  label: string;
  expectedMode: "sse" | "intelligence";
  construct(options: {
    telemetryId?: string;
    licenseToken?: string;
  }): CopilotRuntime | CopilotSseRuntime | CopilotIntelligenceRuntime;
}

/** Installs scope, legacy-setter, sampling, and sink spies. */
function installRuntimeTelemetryIdentitySpies() {
  const createScope = vi.spyOn(telemetry, "createScope");
  const setLicenseToken = vi.spyOn(telemetry, "setLicenseToken");
  const send = vi.spyOn(lambdaClient, "send");
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  const fetchMock = vi.fn(
    (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    random,
    send,
    setLicenseToken,
    createScope,
    restore: () => {
      random.mockRestore();
      send.mockRestore();
      setLicenseToken.mockRestore();
      createScope.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    },
  };
}

const LEGACY_IDENTITY_TOKEN = `header.${Buffer.from(
  '{"telemetry_id":"legacy-license-id"}',
).toString("base64url")}.sig`;

const runtimeTelemetryIdentityCases: readonly RuntimeTelemetryIdentityCase[] = [
  {
    label: "explicit telemetryId over environment and legacy license",
    telemetryId: "explicit-telemetry-id",
    environmentTelemetryId: "environment-telemetry-id",
    licenseToken: LEGACY_IDENTITY_TOKEN,
    expectedIdentity: { telemetryId: "explicit-telemetry-id" },
  },
  {
    label: "CPK_TELEMETRY_ID over legacy license",
    environmentTelemetryId: "environment-telemetry-id",
    licenseToken: LEGACY_IDENTITY_TOKEN,
    expectedIdentity: { telemetryId: "environment-telemetry-id" },
  },
  {
    label: "CPK_TELEMETRY_ID when the explicit telemetryId is empty",
    telemetryId: "",
    environmentTelemetryId: "environment-telemetry-id",
    licenseToken: LEGACY_IDENTITY_TOKEN,
    expectedIdentity: { telemetryId: "environment-telemetry-id" },
  },
  {
    label: "legacy license when standalone option and environment are blank",
    telemetryId: " \t ",
    environmentTelemetryId: "",
    licenseToken: LEGACY_IDENTITY_TOKEN,
    expectedIdentity: { licenseToken: LEGACY_IDENTITY_TOKEN },
  },
  {
    label:
      "anonymous identity when standalone option and environment are blank",
    telemetryId: "",
    environmentTelemetryId: " \t ",
    expectedIdentity: {},
  },
  {
    label: "explicit telemetryId normalized for HTTP transport",
    telemetryId: "\t explicit-telemetry-id \t",
    environmentTelemetryId: "environment-telemetry-id",
    licenseToken: LEGACY_IDENTITY_TOKEN,
    expectedIdentity: { telemetryId: "explicit-telemetry-id" },
  },
  {
    label: "legacy license when no standalone identity exists",
    licenseToken: LEGACY_IDENTITY_TOKEN,
    expectedIdentity: { licenseToken: LEGACY_IDENTITY_TOKEN },
  },
  {
    label: "anonymous identity when no identity source exists",
    expectedIdentity: {},
  },
  {
    label: "header-invalid standalone identity sends anonymously",
    telemetryId: "bad\nid",
    expectedIdentity: {},
  },
];

const runtimeConstructorCases = [
  {
    label: "CopilotRuntime SSE shim",
    expectedMode: "sse",
    construct: ({ telemetryId, licenseToken }) =>
      new CopilotRuntime({
        agents: AGENTS,
        telemetryId,
        licenseToken,
      }),
  },
  {
    label: "direct CopilotSseRuntime",
    expectedMode: "sse",
    construct: ({ telemetryId, licenseToken }) =>
      new CopilotSseRuntime({
        agents: AGENTS,
        telemetryId,
        licenseToken,
      }),
  },
  {
    label: "direct CopilotIntelligenceRuntime",
    expectedMode: "intelligence",
    construct: ({ telemetryId, licenseToken }) =>
      new CopilotIntelligenceRuntime({
        agents: AGENTS,
        intelligence: createIntelligenceClient(),
        identifyUser: IDENTIFY_USER,
        telemetryId,
        licenseToken,
      }),
  },
] satisfies readonly RuntimeConstructorCase[];

const runtimeConstructorIdentityCases = runtimeConstructorCases.flatMap(
  (constructorCase) =>
    runtimeTelemetryIdentityCases.map((identityCase) => ({
      constructorCase,
      identityCase,
    })),
);

const INSTANCE_CREATED_PROPERTIES = {
  actionsAmount: 0,
  endpointTypes: [],
  endpointsAmount: 0,
  "cloud.api_key_provided": false,
} satisfies RuntimeInstanceCreatedInfo;

test.each(runtimeConstructorIdentityCases)(
  "$constructorCase.label resolves $identityCase.label through one atomic telemetry configuration",
  async ({ constructorCase, identityCase }) => {
    const { fetchMock, random, send, setLicenseToken, createScope, restore } =
      installRuntimeTelemetryIdentitySpies();
    vi.stubEnv("CPK_TELEMETRY_ID", identityCase.environmentTelemetryId);
    vi.stubEnv("COPILOTKIT_TELEMETRY_ID", "unsupported-alias");
    vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

    try {
      const runtime = constructorCase.construct({
        telemetryId: identityCase.telemetryId,
        licenseToken: identityCase.licenseToken,
      });

      expect(runtime.mode).toBe(constructorCase.expectedMode);
      expect(createScope).toHaveBeenCalledTimes(1);
      expect(createScope).toHaveBeenCalledWith(identityCase.expectedIdentity);
      expect(setLicenseToken).not.toHaveBeenCalled();

      await runtime.telemetry.capture(
        "oss.runtime.instance_created",
        INSTANCE_CREATED_PROPERTIES,
      );

      expect(send).toHaveBeenCalledTimes(1);
      const hasLicenseSamplingAuthority =
        parseTelemetryIdFromLicense(
          identityCase.expectedIdentity.licenseToken,
        ) !== null;
      expect(random).toHaveBeenCalledTimes(hasLicenseSamplingAuthority ? 0 : 1);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseToken: identityCase.expectedIdentity.licenseToken,
          telemetryId: identityCase.expectedIdentity.telemetryId,
        }),
      );
      const effectiveSampleRate = hasLicenseSamplingAuthority ? 1 : 0.05;
      expect(send.mock.calls[0]?.[0].globalProperties).toEqual({
        sampleRate: effectiveSampleRate,
        sampleRateAdjustmentFactor: 1 - effectiveSampleRate,
        sampleWeight: 1 / effectiveSampleRate,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      const expectedTelemetryId =
        identityCase.expectedIdentity.telemetryId ??
        parseTelemetryIdFromLicense(identityCase.expectedIdentity.licenseToken);
      expect(headers.get("X-CopilotKit-Telemetry-Id")).toBe(
        expectedTelemetryId ?? null,
      );
    } finally {
      restore();
    }
  },
);

test.each(runtimeConstructorCases)(
  "$label creates an anonymous scope without rewriting an identified runtime",
  async (constructorCase) => {
    const { fetchMock, random, send, setLicenseToken, createScope, restore } =
      installRuntimeTelemetryIdentitySpies();
    vi.stubEnv("CPK_TELEMETRY_ID", undefined);
    vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

    try {
      const identifiedRuntime = constructorCase.construct({
        licenseToken: LEGACY_IDENTITY_TOKEN,
      });
      createScope.mockClear();
      setLicenseToken.mockClear();
      send.mockClear();
      fetchMock.mockClear();

      const anonymousRuntime = constructorCase.construct({});

      expect([identifiedRuntime.mode, anonymousRuntime.mode]).toEqual([
        constructorCase.expectedMode,
        constructorCase.expectedMode,
      ]);
      expect(createScope).toHaveBeenCalledTimes(1);
      expect(createScope).toHaveBeenCalledWith({});
      expect(setLicenseToken).not.toHaveBeenCalled();

      await anonymousRuntime.telemetry.capture(
        "oss.runtime.instance_created",
        INSTANCE_CREATED_PROPERTIES,
      );

      expect(random).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        licenseToken: undefined,
        telemetryId: undefined,
      });
      expect(send.mock.calls[0]?.[0].globalProperties).toEqual({
        sampleRate: 0.05,
        sampleRateAdjustmentFactor: 0.95,
        sampleWeight: 20,
      });
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.get("X-CopilotKit-Telemetry-Id")).toBeNull();
    } finally {
      restore();
    }
  },
);

/** Emits the request-created event through the runtime-bound V2 request path. */
async function emitRuntimeRequest(
  runtime: CopilotRuntime | CopilotSseRuntime | CopilotIntelligenceRuntime,
): Promise<Response> {
  return handleRunAgent({
    runtime,
    request: new Request("https://example.com/agent/missing/run", {
      method: "POST",
    }),
    agentId: "missing",
  });
}

test("a licensed runtime keeps full-fidelity telemetry after an anonymous runtime is constructed", async () => {
  const { fetchMock, random, send, restore } =
    installRuntimeTelemetryIdentitySpies();
  random.mockReturnValue(0.99);
  vi.stubEnv("CPK_TELEMETRY_ID", undefined);
  vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

  try {
    const licensedRuntime = new CopilotSseRuntime({
      agents: AGENTS,
      licenseToken: LEGACY_IDENTITY_TOKEN,
    });
    const anonymousRuntime = new CopilotSseRuntime({ agents: AGENTS });

    await emitRuntimeRequest(licensedRuntime);
    await emitRuntimeRequest(anonymousRuntime);

    expect(random).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "oss.runtime.copilot_request_created",
        licenseToken: LEGACY_IDENTITY_TOKEN,
        telemetryId: undefined,
      }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-CopilotKit-Telemetry-Id")).toBe("legacy-license-id");
  } finally {
    restore();
  }
});

test("two standalone-identified runtimes keep their own sampled request identity", async () => {
  const { fetchMock, random, send, restore } =
    installRuntimeTelemetryIdentitySpies();
  random.mockReturnValue(0);
  vi.stubEnv("CPK_TELEMETRY_ID", undefined);
  vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

  try {
    const runtimeA = new CopilotSseRuntime({
      agents: AGENTS,
      telemetryId: "runtime-a",
    });
    const runtimeB = new CopilotSseRuntime({
      agents: AGENTS,
      telemetryId: "runtime-b",
    });

    await emitRuntimeRequest(runtimeA);
    await emitRuntimeRequest(runtimeB);

    expect(random).toHaveBeenCalledTimes(2);
    expect(send.mock.calls).toEqual([
      [
        expect.objectContaining({
          event: "oss.runtime.copilot_request_created",
          licenseToken: undefined,
          telemetryId: "runtime-a",
        }),
      ],
      [
        expect.objectContaining({
          event: "oss.runtime.copilot_request_created",
          licenseToken: undefined,
          telemetryId: "runtime-b",
        }),
      ],
    ]);
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("X-CopilotKit-Telemetry-Id"),
      ),
    ).toEqual(["runtime-a", "runtime-b"]);
  } finally {
    restore();
  }
});
