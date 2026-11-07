import { describe, it, expect, afterEach } from "vitest";
import { resolveTeamsAuth } from "./auth-config.js";

/**
 * Startup errors that `resolveTeamsAuth` must not relabel: only a missing app
 * id is explained as "legacy-only credentials".
 */
describe("resolveTeamsAuth", () => {
  const touched = new Set<string>();
  function setEnv(key: string, value: string) {
    touched.add(key);
    process.env[key] = value;
  }
  afterEach(() => {
    for (const k of touched) delete process.env[k];
    touched.clear();
  });

  it("rethrows an unrelated SDK configuration error even with MicrosoftAppId set", () => {
    setEnv("TEST_MODE", "true");
    setEnv("MicrosoftAppId", "00000000-aaaa-bbbb-cccc-000000000123");
    // A connection map without a "*" entry: the SDK cannot pick a default.
    setEnv("Connections__a__Settings__ClientId", "app-a");
    setEnv("ConnectionsMap__0__ServiceUrl", "https://example.invalid");
    setEnv("ConnectionsMap__0__Connection", "a");
    expect(() => resolveTeamsAuth({})).toThrow(/No default connection/);
  });

  it("still explains legacy-only credentials when no app id resolves", () => {
    setEnv("TEST_MODE", "true");
    setEnv("MicrosoftAppId", "00000000-aaaa-bbbb-cccc-000000000123");
    expect(() => resolveTeamsAuth({})).toThrow(
      /MicrosoftAppId is set, but the M365 Agents SDK does not read/,
    );
  });
});
