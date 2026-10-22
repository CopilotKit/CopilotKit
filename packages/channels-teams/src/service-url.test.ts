import { describe, it, expect } from "vitest";
import {
  DEFAULT_ALLOWED_SERVICE_URLS,
  isAllowedServiceUrl,
  resolveAllowedServiceUrls,
  sameOrigin,
} from "./service-url.js";

describe("isAllowedServiceUrl", () => {
  const allowed = DEFAULT_ALLOWED_SERVICE_URLS;

  it.each([
    "https://smba.trafficmanager.net/amer/",
    "https://smba.trafficmanager.net/teams/",
    "https://smba.infra.gcc.teams.microsoft.com/teams",
    "https://smba.infra.gov.teams.microsoft.us/teams",
    "https://smba.infra.dod.teams.microsoft.us/teams",
    "https://webchat.botframework.com/",
    "https://europe.directline.botframework.com/",
    "https://SMBA.TrafficManager.net:443/emea/",
  ])("allows the Microsoft connector %s", (url) => {
    expect(isAllowedServiceUrl(url, allowed)).toBe(true);
  });

  it.each([
    ["an unknown host", "https://attacker.example/"],
    ["plain http to a known host", "http://smba.trafficmanager.net/amer/"],
    ["a non-default port", "https://smba.trafficmanager.net:8443/amer/"],
    ["a lookalike suffix", "https://smba.trafficmanager.net.attacker.example/"],
    ["a lookalike prefix", "https://evilsmba.trafficmanager.net/"],
    ["the wildcard's bare parent", "https://botframework.com/"],
    ["a suffix without a dot", "https://evilbotframework.com/"],
    [
      "credentials before the host",
      "https://smba.trafficmanager.net@attacker.example/",
    ],
    [
      "userinfo on a known host",
      "https://user:pw@smba.trafficmanager.net/amer/",
    ],
    ["loopback", "http://127.0.0.1:3978/"],
    ["an empty string", ""],
    ["not a URL", "smba.trafficmanager.net"],
  ])("refuses %s", (_label, url) => {
    expect(isAllowedServiceUrl(url, allowed)).toBe(false);
  });

  it("refuses non-string input", () => {
    expect(isAllowedServiceUrl(undefined, allowed)).toBe(false);
    expect(isAllowedServiceUrl(42, allowed)).toBe(false);
  });

  it("adds caller-supplied origins to the defaults", () => {
    const extended = resolveAllowedServiceUrls(["http://127.0.0.1:4000"]);
    expect(isAllowedServiceUrl("http://127.0.0.1:4000/x/", extended)).toBe(
      true,
    );
    expect(isAllowedServiceUrl("http://127.0.0.1:4001/", extended)).toBe(false);
    expect(
      isAllowedServiceUrl("https://smba.trafficmanager.net/amer/", extended),
    ).toBe(true);
  });

  it("ignores malformed allowlist entries instead of matching everything", () => {
    expect(isAllowedServiceUrl("https://a.example/", ["*", "https://*"])).toBe(
      false,
    );
  });
});

describe("sameOrigin", () => {
  it("compares scheme, host and port, not path", () => {
    expect(
      sameOrigin(
        "https://smba.trafficmanager.net/amer/",
        "https://smba.trafficmanager.net/teams/",
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        "https://smba.trafficmanager.net/",
        "https://attacker.example/",
      ),
    ).toBe(false);
    expect(sameOrigin("not a url", "https://a.example/")).toBe(false);
  });
});
