import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";

import { lambdaClient, parseTelemetryIdFromLicense } from "@copilotkit/shared";
import { CopilotRuntime } from "../copilot-runtime";
import telemetry from "../../telemetry-client";
import { telemetry as delegatedTelemetry } from "../../../v2/runtime/telemetry";
import { createCopilotRuntimeHandler } from "../../../v2/runtime";

/**
 * The v1 (GraphQL) CopilotRuntime has its own constructor and telemetry scope.
 * These tests pin license identity to that scope so the v1 path cannot regress
 * into anonymous telemetry.
 */
describe("v1 CopilotRuntime — telemetry license token", () => {
  // Real JWT shape with telemetry_id so the parser doesn't warn.
  const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
    "base64url",
  )}.sig`;

  let createScopeSpy: ReturnType<typeof vi.spyOn>;
  let setLicenseTokenSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
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

  it("forwards an explicit licenseToken option to telemetry", () => {
    const runtime = new CopilotRuntime({ agents: {}, licenseToken: TOKEN });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(createScopeSpy).toHaveBeenCalledWith({
      licenseToken: TOKEN,
    });
    expect(setLicenseTokenSpy).not.toHaveBeenCalled();
  });

  it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
    process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

    const runtime = new CopilotRuntime({ agents: {} });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(createScopeSpy).toHaveBeenCalledWith({
      licenseToken: TOKEN,
    });
    expect(setLicenseTokenSpy).not.toHaveBeenCalled();
  });

  it("does not set a token when none is provided", () => {
    const runtime = new CopilotRuntime({ agents: {} });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(setLicenseTokenSpy).not.toHaveBeenCalled();
  });
});

interface RootRuntimeTelemetryIdentityCase {
  label: string;
  telemetryId?: string;
  environmentTelemetryId?: string;
  licenseToken?: string;
  expectedIdentity: TelemetryIdentity;
}

interface TelemetryIdentity {
  telemetryId?: string;
  licenseToken?: string;
}

/** Installs spies for root Runtime telemetry scope creation. */
function installTelemetryIdentitySpies() {
  const createScope = vi.spyOn(telemetry, "createScope");
  const setLicenseToken = vi
    .spyOn(telemetry, "setLicenseToken")
    .mockImplementation(() => {});

  return {
    createScope,
    setLicenseToken,
    restore: () => {
      setLicenseToken.mockRestore();
      createScope.mockRestore();
      vi.unstubAllEnvs();
    },
  };
}

/** Installs scope spies that expose the delegated V2 sink state. */
function installDelegatedTelemetryIdentitySpies() {
  const createScope = vi.spyOn(delegatedTelemetry, "createScope");
  const setLicenseToken = vi.spyOn(delegatedTelemetry, "setLicenseToken");
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
    },
  };
}

const LEGACY_IDENTITY_TOKEN = `header.${Buffer.from(
  '{"telemetry_id":"legacy-license-id"}',
).toString("base64url")}.sig`;

const rootRuntimeTelemetryIdentityCases = [
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
] satisfies readonly RootRuntimeTelemetryIdentityCase[];

test.each(rootRuntimeTelemetryIdentityCases)(
  "public root Runtime resolves $label through one atomic telemetry configuration",
  async ({
    telemetryId,
    environmentTelemetryId,
    licenseToken,
    expectedIdentity,
  }) => {
    const { createScope, setLicenseToken, restore } =
      installTelemetryIdentitySpies();
    const {
      fetchMock,
      random,
      send,
      setLicenseToken: delegatedSetLicenseToken,
      createScope: delegatedCreateScope,
      restore: restoreDelegatedTelemetry,
    } = installDelegatedTelemetryIdentitySpies();
    vi.stubEnv("CPK_TELEMETRY_ID", environmentTelemetryId);
    vi.stubEnv("COPILOTKIT_TELEMETRY_ID", "unsupported-alias");
    vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

    try {
      const runtime = new CopilotRuntime({
        agents: {},
        telemetryId,
        licenseToken,
      });

      expect(runtime).toBeInstanceOf(CopilotRuntime);
      expect(runtime.instance).toBeDefined();
      expect(createScope).toHaveBeenCalledTimes(1);
      expect(createScope).toHaveBeenCalledWith(expectedIdentity);
      expect(setLicenseToken).not.toHaveBeenCalled();
      expect(delegatedCreateScope).toHaveBeenCalledTimes(1);
      expect(delegatedCreateScope).toHaveBeenCalledWith(expectedIdentity);
      expect(delegatedSetLicenseToken).not.toHaveBeenCalled();

      await runtime.instance.telemetry.capture("oss.runtime.instance_created", {
        actionsAmount: 0,
        endpointTypes: [],
        endpointsAmount: 0,
        "cloud.api_key_provided": false,
      });

      expect(send).toHaveBeenCalledTimes(1);
      const hasLicenseSamplingAuthority =
        parseTelemetryIdFromLicense(expectedIdentity.licenseToken) !== null;
      expect(random).toHaveBeenCalledTimes(hasLicenseSamplingAuthority ? 0 : 1);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseToken: expectedIdentity.licenseToken,
          telemetryId: expectedIdentity.telemetryId,
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      const expectedTelemetryId =
        expectedIdentity.telemetryId ??
        parseTelemetryIdFromLicense(expectedIdentity.licenseToken);
      expect(headers.get("X-CopilotKit-Telemetry-Id")).toBe(
        expectedTelemetryId ?? null,
      );
    } finally {
      restoreDelegatedTelemetry();
      restore();
    }
  },
);

test("public root Runtime delegates an anonymous telemetry scope into V2", async () => {
  const { createScope, setLicenseToken, restore } =
    installTelemetryIdentitySpies();
  const {
    fetchMock,
    send,
    setLicenseToken: delegatedSetLicenseToken,
    createScope: delegatedCreateScope,
    restore: restoreDelegatedTelemetry,
  } = installDelegatedTelemetryIdentitySpies();
  vi.stubEnv("CPK_TELEMETRY_ID", undefined);
  vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

  try {
    const identifiedRuntime = new CopilotRuntime({
      agents: {},
      licenseToken: LEGACY_IDENTITY_TOKEN,
    });
    expect(identifiedRuntime.instance).toBeDefined();

    createScope.mockClear();
    setLicenseToken.mockClear();
    delegatedCreateScope.mockClear();
    delegatedSetLicenseToken.mockClear();
    send.mockClear();
    fetchMock.mockClear();

    const anonymousRuntime = new CopilotRuntime({ agents: {} });

    expect(createScope).toHaveBeenCalledTimes(1);
    expect(createScope).toHaveBeenCalledWith({});
    expect(setLicenseToken).not.toHaveBeenCalled();

    expect(anonymousRuntime.instance).toBeDefined();
    expect(delegatedCreateScope).toHaveBeenCalledTimes(1);
    expect(delegatedCreateScope).toHaveBeenCalledWith({});
    expect(delegatedSetLicenseToken).not.toHaveBeenCalled();

    await anonymousRuntime.instance.telemetry.capture(
      "oss.runtime.instance_created",
      {
        actionsAmount: 0,
        endpointTypes: [],
        endpointsAmount: 0,
        "cloud.api_key_provided": false,
      },
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        licenseToken: undefined,
        telemetryId: undefined,
      }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-CopilotKit-Telemetry-Id")).toBeNull();
  } finally {
    restoreDelegatedTelemetry();
    restore();
  }
});

function createRootRuntimeRequest(): Request {
  return new Request("https://example.com/agent/missing/run", {
    method: "POST",
  });
}

test("public root runtimes keep request identity across lazy V2 instance creation", async () => {
  const { restore } = installTelemetryIdentitySpies();
  const {
    fetchMock,
    random,
    send,
    restore: restoreDelegatedTelemetry,
  } = installDelegatedTelemetryIdentitySpies();
  random.mockReturnValue(0);
  vi.stubEnv("CPK_TELEMETRY_ID", undefined);
  vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

  try {
    const rootRuntimeA = new CopilotRuntime({
      agents: {},
      telemetryId: "root-runtime-a",
    });
    const rootRuntimeB = new CopilotRuntime({
      agents: {},
      telemetryId: "root-runtime-b",
    });
    const handlerA = createCopilotRuntimeHandler({
      runtime: rootRuntimeA.instance,
      basePath: "/",
    });
    const handlerB = createCopilotRuntimeHandler({
      runtime: rootRuntimeB.instance,
      basePath: "/",
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    send.mockClear();
    fetchMock.mockClear();
    random.mockClear();

    await handlerA(createRootRuntimeRequest());
    await handlerB(createRootRuntimeRequest());

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(4));
    expect(random).toHaveBeenCalledTimes(4);
    expect(
      send.mock.calls.map(([event]) => ({
        event: event.event,
        telemetryId: event.telemetryId,
      })),
    ).toEqual([
      {
        event: "oss.runtime.copilot_request_created",
        telemetryId: "root-runtime-a",
      },
      {
        event: "oss.runtime.copilot_request_created",
        telemetryId: "root-runtime-a",
      },
      {
        event: "oss.runtime.copilot_request_created",
        telemetryId: "root-runtime-b",
      },
      {
        event: "oss.runtime.copilot_request_created",
        telemetryId: "root-runtime-b",
      },
    ]);
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("X-CopilotKit-Telemetry-Id"),
      ),
    ).toEqual([
      "root-runtime-a",
      "root-runtime-a",
      "root-runtime-b",
      "root-runtime-b",
    ]);
  } finally {
    restoreDelegatedTelemetry();
    restore();
  }
});
