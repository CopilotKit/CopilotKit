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
 * Every runtime construction path feeds the same endpoints, and all endpoints
 * share the process-wide `telemetry` singleton. So telemetry attribution is
 * decided entirely at construction time: if the runtime constructor forwards
 * the license token to `telemetry.setLicenseToken`, every downstream event
 * (instance_created, copilot_request_created, agent_execution_*) carries the
 * telemetry_id; if it doesn't, those events are anonymous and sample-gated.
 *
 * Regression guard for the gap where only CopilotIntelligenceRuntime set the
 * token, so self-hosted SSE users never got a telemetry_id on their events.
 */
describe("runtime construction — telemetry license token", () => {
  // Real JWT shape with telemetry_id so the parser doesn't warn.
  const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
    "base64url",
  )}.sig`;

  let setTelemetryIdentitySpy: ReturnType<typeof vi.spyOn>;
  let setLicenseTokenSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Spy with a no-op impl so the shared singleton's identified/anonymous
    // state is never mutated across tests — we assert the call, not state.
    setTelemetryIdentitySpy = vi
      .spyOn(telemetry, "setTelemetryIdentity")
      .mockImplementation(() => {});
    setLicenseTokenSpy = vi.spyOn(telemetry, "setLicenseToken");
    originalEnv = process.env.COPILOTKIT_LICENSE_TOKEN;
    delete process.env.COPILOTKIT_LICENSE_TOKEN;
  });

  afterEach(() => {
    setLicenseTokenSpy.mockRestore();
    setTelemetryIdentitySpy.mockRestore();
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
      expect(setTelemetryIdentitySpy).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });

    it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
      process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

      const runtime = new CopilotSseRuntime({ agents: AGENTS });

      expect(runtime.mode).toBe("sse");
      expect(setTelemetryIdentitySpy).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
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
      expect(setTelemetryIdentitySpy).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
        licenseToken: TOKEN,
      });
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });

    it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
      process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

      const runtime = new CopilotRuntime({ agents: AGENTS });

      expect(runtime.mode).toBe("sse");
      expect(setTelemetryIdentitySpy).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
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
      expect(setTelemetryIdentitySpy).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
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
      expect(setTelemetryIdentitySpy).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
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
      expect(setTelemetryIdentitySpy).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
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

interface RuntimeTelemetryIdentity {
  telemetryId?: string;
  licenseToken?: string;
}

/** Installs atomic and legacy setters that mutate the real telemetry singleton. */
function installRuntimeTelemetryIdentitySpies() {
  const applyIdentity = (identity: RuntimeTelemetryIdentity) => {
    Reflect.set(telemetry, "licenseToken", identity.licenseToken ?? null);
    Reflect.set(
      telemetry,
      "telemetryId",
      identity.telemetryId ??
        parseTelemetryIdFromLicense(identity.licenseToken) ??
        null,
    );
  };
  const setTelemetryIdentity = vi.fn(applyIdentity);
  Object.defineProperty(telemetry, "setTelemetryIdentity", {
    configurable: true,
    value: setTelemetryIdentity,
  });
  const setLicenseToken = vi
    .spyOn(telemetry, "setLicenseToken")
    .mockImplementation((licenseToken) => applyIdentity({ licenseToken }));
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
    setTelemetryIdentity,
    restore: () => {
      applyIdentity({});
      random.mockRestore();
      send.mockRestore();
      setLicenseToken.mockRestore();
      Reflect.deleteProperty(telemetry, "setTelemetryIdentity");
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
    label: "opaque nonblank explicit telemetryId bytes without trimming",
    telemetryId: " explicit-telemetry-id ",
    environmentTelemetryId: "environment-telemetry-id",
    licenseToken: LEGACY_IDENTITY_TOKEN,
    expectedIdentity: { telemetryId: " explicit-telemetry-id " },
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
    const {
      fetchMock,
      random,
      send,
      setLicenseToken,
      setTelemetryIdentity,
      restore,
    } = installRuntimeTelemetryIdentitySpies();
    vi.stubEnv("CPK_TELEMETRY_ID", identityCase.environmentTelemetryId);
    vi.stubEnv("COPILOTKIT_TELEMETRY_ID", "unsupported-alias");
    vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

    try {
      const runtime = constructorCase.construct({
        telemetryId: identityCase.telemetryId,
        licenseToken: identityCase.licenseToken,
      });

      expect(runtime.mode).toBe(constructorCase.expectedMode);
      expect(setTelemetryIdentity).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentity).toHaveBeenCalledWith(
        identityCase.expectedIdentity,
      );
      expect(setLicenseToken).not.toHaveBeenCalled();

      await telemetry.capture(
        "oss.runtime.instance_created",
        INSTANCE_CREATED_PROPERTIES,
      );

      expect(send).toHaveBeenCalledTimes(1);
      const identified =
        identityCase.expectedIdentity.telemetryId !== undefined ||
        identityCase.expectedIdentity.licenseToken !== undefined;
      expect(random).toHaveBeenCalledTimes(identified ? 0 : 1);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseToken: identityCase.expectedIdentity.licenseToken,
          telemetryId: identityCase.expectedIdentity.telemetryId,
        }),
      );
      expect(send.mock.calls[0]?.[0]).not.toHaveProperty("globalProperties");
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      const expectedHeaders = new Headers();
      const expectedTelemetryId =
        identityCase.expectedIdentity.telemetryId ??
        parseTelemetryIdFromLicense(identityCase.expectedIdentity.licenseToken);
      if (expectedTelemetryId !== null && expectedTelemetryId !== undefined) {
        expectedHeaders.set("X-CopilotKit-Telemetry-Id", expectedTelemetryId);
      }
      expect(headers.get("X-CopilotKit-Telemetry-Id")).toBe(
        expectedHeaders.get("X-CopilotKit-Telemetry-Id"),
      );
    } finally {
      restore();
    }
  },
);

test.each(runtimeConstructorCases)(
  "$label clears an earlier singleton identity before an anonymous send",
  async (constructorCase) => {
    const {
      fetchMock,
      random,
      send,
      setLicenseToken,
      setTelemetryIdentity,
      restore,
    } = installRuntimeTelemetryIdentitySpies();
    vi.stubEnv("CPK_TELEMETRY_ID", undefined);
    vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

    try {
      const identifiedRuntime = constructorCase.construct({
        licenseToken: LEGACY_IDENTITY_TOKEN,
      });
      setTelemetryIdentity.mockClear();
      setLicenseToken.mockClear();
      send.mockClear();
      fetchMock.mockClear();

      const anonymousRuntime = constructorCase.construct({});

      expect([identifiedRuntime.mode, anonymousRuntime.mode]).toEqual([
        constructorCase.expectedMode,
        constructorCase.expectedMode,
      ]);
      expect(setTelemetryIdentity).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentity).toHaveBeenCalledWith({});
      expect(setLicenseToken).not.toHaveBeenCalled();

      await telemetry.capture(
        "oss.runtime.instance_created",
        INSTANCE_CREATED_PROPERTIES,
      );

      expect(random).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        licenseToken: undefined,
        telemetryId: undefined,
      });
      expect(send.mock.calls[0]?.[0]).not.toHaveProperty("globalProperties");
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.get("X-CopilotKit-Telemetry-Id")).toBeNull();
    } finally {
      restore();
    }
  },
);
