import { describe, it, expect } from "vitest";
import { classifyModelHost, MODEL_HOST_CLASSES } from "./model-host";
import type { ModelHostClass } from "./model-host";

describe("classifyModelHost", () => {
  describe("the case this exists for: an OpenAI-shaped client aimed elsewhere", () => {
    // Every row below reports `provider: "openai.responses"` from the AI SDK,
    // so the provider label cannot tell them apart. The host can.
    it.each([
      ["https://api.openai.com/v1", "openai"],
      ["https://myresource.openai.azure.com/openai/v1", "azure"],
      ["https://myresource.services.ai.azure.com/models", "azure"],
      ["https://myresource.cognitiveservices.azure.com/", "azure"],
      ["https://openrouter.ai/api/v1", "openrouter"],
      ["http://localhost:11434/v1", "local"],
      ["https://llm.internal.acme.example/v1", "other"],
    ])("classifies %s as %s", (baseUrl, expected) => {
      expect(classifyModelHost(baseUrl, "openai")).toBe(expected);
    });
  });

  describe("absent base URL falls back to the provider default", () => {
    it("returns the provider default when the base URL is undefined", () => {
      expect(classifyModelHost(undefined, "openai")).toBe("openai");
      expect(classifyModelHost(undefined, "anthropic")).toBe("anthropic");
    });

    it("returns the provider default for null and empty string", () => {
      expect(classifyModelHost(null, "vertex")).toBe("vertex");
      expect(classifyModelHost("", "vertex")).toBe("vertex");
      expect(classifyModelHost("   ", "vertex")).toBe("vertex");
    });

    it("defaults to unknown when the caller supplies no provider default", () => {
      // This is the pre-built LanguageModel case: nobody knows the host.
      expect(classifyModelHost(undefined)).toBe("unknown");
    });
  });

  describe("known vendor hosts", () => {
    it.each([
      ["https://api.anthropic.com", "anthropic"],
      ["https://generativelanguage.googleapis.com/v1beta", "google"],
      ["https://us-central1-aiplatform.googleapis.com/v1", "vertex"],
      ["https://bedrock-runtime.us-east-1.amazonaws.com", "bedrock"],
      ["https://api.groq.com/openai/v1", "groq"],
      ["https://api.unify.ai/v0/", "unify"],
      ["https://api.minimax.io/v1", "minimax"],
    ])("classifies %s as %s", (baseUrl, expected) => {
      expect(classifyModelHost(baseUrl)).toBe(expected);
    });
  });

  describe("local and private endpoints", () => {
    it.each([
      "http://localhost:1234/v1",
      "http://127.0.0.1:8000/v1",
      "http://[::1]:11434/v1",
      "http://0.0.0.0:11434/v1",
      "http://10.1.2.3:8000/v1",
      "http://192.168.1.50:8000/v1",
      "http://172.16.0.9:8000/v1",
      "http://172.31.255.254:8000/v1",
      "http://host.docker.internal:11434/v1",
      "http://ollama.local:11434/v1",
    ])("treats %s as local", (baseUrl) => {
      expect(classifyModelHost(baseUrl, "openai")).toBe("local");
    });

    it("does not mistake a public 172.x address for a private one", () => {
      // 172.32.x is outside the 172.16.0.0/12 private block.
      expect(classifyModelHost("http://172.32.0.1:8000/v1", "openai")).toBe(
        "other",
      );
    });
  });

  describe("it never leaks the host", () => {
    it.each([
      "https://myresource.openai.azure.com/openai/v1",
      "https://acme-secret-gateway.internal.example/v1",
      "not a url at all",
      "://malformed",
      "ftp://weird.example/v1",
    ])("returns a closed-vocabulary value for %s", (baseUrl) => {
      const result = classifyModelHost(baseUrl, "openai");
      expect(MODEL_HOST_CLASSES).toContain(result);
      // The customer's resource name must never reach telemetry.
      expect(result).not.toContain("myresource");
      expect(result).not.toContain("acme");
    });

    it("classifies an unparseable base URL as other, not unknown", () => {
      // `unknown` means "we could not observe a host". A malformed string
      // means we did observe one and failed to read it. Those differ.
      expect(classifyModelHost("not a url at all", "openai")).toBe("other");
    });
  });

  describe("normalization", () => {
    it("ignores case and trailing whitespace", () => {
      expect(
        classifyModelHost("  HTTPS://MyResource.OpenAI.Azure.COM/openai/v1  "),
      ).toBe("azure");
    });

    it("ignores port, path and query", () => {
      expect(
        classifyModelHost("https://api.openai.com:443/v1/chat?x=1#frag"),
      ).toBe("openai");
    });

    it("does not match a lookalike suffix", () => {
      // `evil-openai.azure.com.attacker.example` must not read as azure.
      expect(
        classifyModelHost("https://myresource.openai.azure.com.attacker.test/"),
      ).toBe("other");
      // A bare substring is not a suffix match either.
      expect(classifyModelHost("https://notapi.openai.com.example/")).toBe(
        "other",
      );
    });
  });

  describe("the vocabulary is closed", () => {
    it("exposes unknown and other as members", () => {
      expect(MODEL_HOST_CLASSES).toContain("unknown");
      expect(MODEL_HOST_CLASSES).toContain("other");
    });

    it("has no duplicate members", () => {
      expect(new Set(MODEL_HOST_CLASSES).size).toBe(MODEL_HOST_CLASSES.length);
    });

    it("accepts every member as a provider default", () => {
      for (const member of MODEL_HOST_CLASSES) {
        const value: ModelHostClass = classifyModelHost(undefined, member);
        expect(value).toBe(member);
      }
    });
  });
});
