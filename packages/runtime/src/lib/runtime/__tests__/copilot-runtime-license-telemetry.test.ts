import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";

import { lambdaClient, parseTelemetryIdFromLicense } from "@copilotkit/shared";
import { CopilotRuntime } from "../copilot-runtime";
import telemetry from "../../telemetry-client";
import { telemetry as delegatedTelemetry } from "../../../v2/runtime/telemetry";

/**
 * The v1 (GraphQL) CopilotRuntime is a separate endpoint path from the v2
 * runtime, with its own constructor. It already forwards the license token to
 * telemetry — this pins that behavior so the v1 path can't silently regress
 * into anonymous telemetry the way the v2 SSE path did.
 */
describe("v1 CopilotRuntime — telemetry license token", () => {
  // Real JWT shape with telemetry_id so the parser doesn't warn.
  const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
    "base64url",
  )}.sig`;

  let setTelemetryIdentitySpy: ReturnType<typeof vi.spyOn>;
  let setLicenseTokenSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
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

  it("forwards an explicit licenseToken option to telemetry", () => {
    const runtime = new CopilotRuntime({ agents: {}, licenseToken: TOKEN });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
      licenseToken: TOKEN,
    });
    expect(setLicenseTokenSpy).not.toHaveBeenCalled();
  });

  it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
    process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

    const runtime = new CopilotRuntime({ agents: {} });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(setTelemetryIdentitySpy).toHaveBeenCalledWith({
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

/** Installs the wished atomic identity API without mutating singleton state. */
function installTelemetryIdentitySpies() {
  const setTelemetryIdentity = vi.fn<(identity: TelemetryIdentity) => void>();
  Object.defineProperty(telemetry, "setTelemetryIdentity", {
    configurable: true,
    value: setTelemetryIdentity,
  });
  const setLicenseToken = vi
    .spyOn(telemetry, "setLicenseToken")
    .mockImplementation(() => {});

  return {
    setTelemetryIdentity,
    setLicenseToken,
    restore: () => {
      setLicenseToken.mockRestore();
      Reflect.deleteProperty(telemetry, "setTelemetryIdentity");
      vi.unstubAllEnvs();
    },
  };
}

/** Installs identity setters that expose the final delegated V2 sink state. */
function installDelegatedTelemetryIdentitySpies() {
  const setTelemetryIdentity = vi.spyOn(
    delegatedTelemetry,
    "setTelemetryIdentity",
  );
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
    setTelemetryIdentity,
    restore: () => {
      delegatedTelemetry.setTelemetryIdentity({});
      random.mockRestore();
      send.mockRestore();
      setLicenseToken.mockRestore();
      setTelemetryIdentity.mockRestore();
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
] satisfies readonly RootRuntimeTelemetryIdentityCase[];

test.each(rootRuntimeTelemetryIdentityCases)(
  "public root Runtime resolves $label through one atomic telemetry configuration",
  async ({
    telemetryId,
    environmentTelemetryId,
    licenseToken,
    expectedIdentity,
  }) => {
    const { setTelemetryIdentity, setLicenseToken, restore } =
      installTelemetryIdentitySpies();
    const {
      fetchMock,
      random,
      send,
      setLicenseToken: delegatedSetLicenseToken,
      setTelemetryIdentity: delegatedSetTelemetryIdentity,
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
      expect(setTelemetryIdentity).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentity).toHaveBeenCalledWith(expectedIdentity);
      expect(setLicenseToken).not.toHaveBeenCalled();
      expect(delegatedSetTelemetryIdentity).toHaveBeenCalledTimes(1);
      expect(delegatedSetTelemetryIdentity).toHaveBeenCalledWith(
        expectedIdentity,
      );
      expect(delegatedSetLicenseToken).not.toHaveBeenCalled();

      await delegatedTelemetry.capture("oss.runtime.instance_created", {
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
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      const expectedHeaders = new Headers();
      const expectedTelemetryId =
        expectedIdentity.telemetryId ??
        parseTelemetryIdFromLicense(expectedIdentity.licenseToken);
      if (expectedTelemetryId !== null && expectedTelemetryId !== undefined) {
        expectedHeaders.set("X-CopilotKit-Telemetry-Id", expectedTelemetryId);
      }
      expect(headers.get("X-CopilotKit-Telemetry-Id")).toBe(
        expectedHeaders.get("X-CopilotKit-Telemetry-Id"),
      );
    } finally {
      restoreDelegatedTelemetry();
      restore();
    }
  },
);

test("public root Runtime delegates anonymous identity clearing into V2", async () => {
  const { setTelemetryIdentity, setLicenseToken, restore } =
    installTelemetryIdentitySpies();
  const {
    fetchMock,
    send,
    setLicenseToken: delegatedSetLicenseToken,
    setTelemetryIdentity: delegatedSetTelemetryIdentity,
    restore: restoreDelegatedTelemetry,
  } = installDelegatedTelemetryIdentitySpies();
  let activeIdentity: TelemetryIdentity = {};
  setTelemetryIdentity.mockImplementation((identity) => {
    activeIdentity = identity;
  });
  setLicenseToken.mockImplementation((licenseToken) => {
    activeIdentity = { licenseToken };
  });
  vi.stubEnv("CPK_TELEMETRY_ID", undefined);
  vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", undefined);

  try {
    const identifiedRuntime = new CopilotRuntime({
      agents: {},
      licenseToken: LEGACY_IDENTITY_TOKEN,
    });
    expect(identifiedRuntime.instance).toBeDefined();

    setTelemetryIdentity.mockClear();
    setLicenseToken.mockClear();
    delegatedSetTelemetryIdentity.mockClear();
    delegatedSetLicenseToken.mockClear();
    send.mockClear();
    fetchMock.mockClear();

    const anonymousRuntime = new CopilotRuntime({ agents: {} });

    expect(activeIdentity).toEqual({});
    expect(setTelemetryIdentity).toHaveBeenCalledTimes(1);
    expect(setTelemetryIdentity).toHaveBeenCalledWith({});
    expect(setLicenseToken).not.toHaveBeenCalled();

    expect(anonymousRuntime.instance).toBeDefined();
    expect(delegatedSetTelemetryIdentity).toHaveBeenCalledTimes(1);
    expect(delegatedSetTelemetryIdentity).toHaveBeenCalledWith({});
    expect(delegatedSetLicenseToken).not.toHaveBeenCalled();

    await delegatedTelemetry.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

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
