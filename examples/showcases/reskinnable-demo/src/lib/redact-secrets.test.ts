/**
 * The redactor's contract, tested at the level the CALLERS cannot: a route test
 * proves one body is clean, these prove the needle DERIVATION is, which is where
 * the class of bug lives. Its predecessor in commerce's `dev/reset` was correct
 * about the one secret it was handed and silent about the other four.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { envSecretNeedles, redactSecrets } from "./redact-secrets";

/** Distinctive on purpose: asserting against `localhost` proves little. */
const API_URL = "http://memory.internal.example:7250";
const WS_URL = "ws://gateway.internal.example:7253";
const API_KEY = "cpk_s2PRVSED_seed0privat0longtoken01";
const LICENSE = "eyJhbGciOiJFZERTQSJ9.license-payload.sig";
const OPENAI_KEY = "sk-proj-abcdef0123456789";

function stubEverySecret() {
  vi.stubEnv("INTELLIGENCE_API_URL", API_URL);
  vi.stubEnv("INTELLIGENCE_GATEWAY_WS_URL", WS_URL);
  vi.stubEnv("INTELLIGENCE_API_KEY", API_KEY);
  vi.stubEnv("COPILOTKIT_LICENSE_TOKEN", LICENSE);
  vi.stubEnv("OPENAI_API_KEY", OPENAI_KEY);
}

/** Every secret unset, so a passthrough case cannot be satisfied by luck. */
function stubNoSecrets() {
  for (const key of [
    "INTELLIGENCE_API_URL",
    "INTELLIGENCE_GATEWAY_WS_URL",
    "INTELLIGENCE_API_KEY",
    "COPILOTKIT_LICENSE_TOKEN",
    "OPENAI_API_KEY",
  ]) {
    vi.stubEnv(key, undefined);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("redactSecrets", () => {
  it("removes every configured secret from one message", async () => {
    stubEverySecret();

    const out = redactSecrets(
      `POST ${API_URL}/api/memories with key ${API_KEY} (gateway ${WS_URL}, ` +
        `license ${LICENSE}, llm ${OPENAI_KEY}) failed`,
    );

    for (const secret of [API_URL, WS_URL, API_KEY, LICENSE, OPENAI_KEY]) {
      expect(out).not.toContain(secret);
    }
    // Each placeholder NAMES its secret, so a redacted message still diagnoses.
    expect(out).toContain("<intelligence-backend>");
    expect(out).toContain("<intelligence-api-key>");
    expect(out).toContain("<intelligence-gateway>");
    expect(out).toContain("<license-token>");
    expect(out).toContain("<openai-api-key>");
    // And the surrounding wording — the part a presenter reads — is untouched.
    expect(out).toContain("POST");
    expect(out).toContain("/api/memories");
    expect(out).toContain("failed");
  });

  it("removes a URL's host WITH and WITHOUT its port", () => {
    stubEverySecret();

    // `URL.hostname` (portless) is a substring of neither the raw URL nor
    // `URL.host`, so a needle set built from those two leaves it behind. Real
    // messages produce it: `getaddrinfo ENOTFOUND <hostname>`.
    expect(redactSecrets("getaddrinfo ENOTFOUND memory.internal.example")).toBe(
      "getaddrinfo ENOTFOUND <intelligence-backend>",
    );
    expect(
      redactSecrets("proxy could not reach memory.internal.example:7250"),
    ).toBe("proxy could not reach <intelligence-backend>");
  });

  it("replaces the full URL before its host can shadow it", () => {
    stubEverySecret();

    // Shortest-first would leave `http://<intelligence-backend>/api/memories`,
    // which still publishes the scheme and the path shape of the internal API.
    const out = redactSecrets(
      `Failed to parse URL from ${API_URL}/api/memories`,
    );

    expect(out).toBe(
      "Failed to parse URL from <intelligence-backend>/api/memories",
    );
    expect(out).not.toContain("http://<intelligence-backend>");
  });

  it("removes a trailing-slash URL quoted back without its slash", () => {
    vi.stubEnv("INTELLIGENCE_API_URL", `${API_URL}/`);

    expect(redactSecrets(`connect ECONNREFUSED ${API_URL}`)).toBe(
      "connect ECONNREFUSED <intelligence-backend>",
    );
  });

  it("still scrubs the raw form of an UNPARSABLE url secret", () => {
    // A malformed env is exactly the case whose parse error quotes it verbatim,
    // and `new URL()` throws, so only the raw forms are derivable.
    vi.stubEnv("INTELLIGENCE_API_URL", "memory.internal.example:not-a-port");
    vi.stubEnv("INTELLIGENCE_API_KEY", API_KEY);

    expect(
      redactSecrets(
        "Failed to parse URL from memory.internal.example:not-a-port",
      ),
    ).toBe("Failed to parse URL from <intelligence-backend>");
  });

  describe("a secret that is absent or empty", () => {
    /**
     * The degenerate-needle rule, and the reason it is a TEST rather than a
     * comment: `"abc".split("")` is every character, so an empty needle joined
     * on a placeholder rewrites the entire message into placeholders — losing
     * the diagnosis a presenter needs while reading exactly like a successful
     * redaction.
     */
    it("yields NO needle rather than an empty one", () => {
      stubNoSecrets();

      expect(envSecretNeedles()).toEqual([]);
      const message = "interrupted during the wipe phase: 503 nope";
      expect(redactSecrets(message)).toBe(message);
    });

    it("treats a set-but-empty env var the same as unset", () => {
      stubNoSecrets();
      vi.stubEnv("INTELLIGENCE_API_KEY", "");

      expect(envSecretNeedles()).toEqual([]);
      expect(redactSecrets("HTTP 401 unauthorized")).toBe(
        "HTTP 401 unauthorized",
      );
    });

    it("covers the secrets that ARE set when others are missing", () => {
      // The OSS path sets no Intelligence vars at all; a partly-configured env
      // must still be covered for what it does hold, not skipped wholesale.
      stubNoSecrets();
      vi.stubEnv("INTELLIGENCE_API_KEY", API_KEY);

      const out = redactSecrets(`HTTP 401 invalid api key ${API_KEY}`);
      expect(out).toBe("HTTP 401 invalid api key <intelligence-api-key>");
    });
  });

  describe("envSecretNeedles", () => {
    it("sorts longest first, and emits no empty values", () => {
      stubEverySecret();

      const needles = envSecretNeedles();
      const lengths = needles.map((n) => n.value.length);
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
      expect(needles.every((n) => n.value.length > 0)).toBe(true);
    });

    it("reads the CURRENT environment on every call", () => {
      // Derived per call, never cached at module load: the reset route builds a
      // response after reading env itself, and a needle set frozen at import
      // time would go stale under any per-request env change (and, more
      // practically, under `vi.stubEnv`).
      stubNoSecrets();
      expect(envSecretNeedles()).toEqual([]);
      vi.stubEnv("INTELLIGENCE_API_KEY", API_KEY);
      expect(envSecretNeedles().map((n) => n.value)).toEqual([API_KEY]);
    });

    it("names a form shared by two secrets once", () => {
      // Two URLs on ONE host (the local docker-compose shape) share a hostname.
      // Emitting it twice would replace it, then hunt for it inside its own
      // placeholder; the first declaration wins and the value appears once.
      stubNoSecrets();
      vi.stubEnv("INTELLIGENCE_API_URL", "http://one.host.example:7250");
      vi.stubEnv("INTELLIGENCE_GATEWAY_WS_URL", "ws://one.host.example:7253");

      const values = envSecretNeedles().map((n) => n.value);
      expect(values.length).toBe(new Set(values).size);
      expect(
        envSecretNeedles().find((n) => n.value === "one.host.example")
          ?.placeholder,
      ).toBe("<intelligence-backend>");
    });
  });
});
