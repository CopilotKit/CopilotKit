import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";

import { CopilotRuntime } from "../copilot-runtime";
import telemetry from "../../telemetry-client";

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

  let setLicenseTokenSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    setLicenseTokenSpy = vi
      .spyOn(telemetry, "setLicenseToken")
      .mockImplementation(() => {});
    originalEnv = process.env.COPILOTKIT_LICENSE_TOKEN;
    delete process.env.COPILOTKIT_LICENSE_TOKEN;
  });

  afterEach(() => {
    setLicenseTokenSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.COPILOTKIT_LICENSE_TOKEN;
    } else {
      process.env.COPILOTKIT_LICENSE_TOKEN = originalEnv;
    }
  });

  it("forwards an explicit licenseToken option to telemetry", () => {
    const runtime = new CopilotRuntime({ agents: {}, licenseToken: TOKEN });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
  });

  it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
    process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

    const runtime = new CopilotRuntime({ agents: {} });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
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
  ({ telemetryId, environmentTelemetryId, licenseToken, expectedIdentity }) => {
    const { setTelemetryIdentity, setLicenseToken, restore } =
      installTelemetryIdentitySpies();
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
      expect(setTelemetryIdentity).toHaveBeenCalledTimes(1);
      expect(setTelemetryIdentity).toHaveBeenCalledWith(expectedIdentity);
      expect(setLicenseToken).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  },
);

test("public root Runtime delegates anonymous identity clearing into V2", () => {
  const { setTelemetryIdentity, setLicenseToken, restore } =
    installTelemetryIdentitySpies();
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

    const anonymousRuntime = new CopilotRuntime({ agents: {} });
    setTelemetryIdentity.mockClear();
    setLicenseToken.mockClear();

    expect(anonymousRuntime.instance).toBeDefined();
    expect(activeIdentity).toEqual({});
    expect(setTelemetryIdentity).toHaveBeenCalledTimes(1);
    expect(setTelemetryIdentity).toHaveBeenCalledWith({});
    expect(setLicenseToken).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});
