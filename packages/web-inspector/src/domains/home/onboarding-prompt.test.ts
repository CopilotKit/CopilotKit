import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ONBOARDING_PROMPT_TEMPLATE,
  createOnboardingPrompt,
  createOnboardingRunId,
} from "./onboarding-prompt.js";

describe("onboarding-prompt", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the CLI entry point the graph resolves", () => {
    expect(ONBOARDING_PROMPT_TEMPLATE).toContain(
      "npx --yes copilotkit@latest onboard start --run <run-id> --coding-agent <coding-agent-slug>",
    );
  });

  it("substitutes the run id and leaves no run placeholder behind", () => {
    const prompt = createOnboardingPrompt("abc123def456");

    expect(prompt).toContain("--run abc123def456");
    expect(prompt).not.toContain("<run-id>");
    expect(prompt).toContain("<coding-agent-slug>");
  });

  it("mints a 12-character id from randomUUID", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "4f8c2b1a-9d3e-4a7b-8c5f-1e2d3a4b5c6d",
    });

    expect(createOnboardingRunId()).toBe("4f8c2b1a9d3e");
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      },
    });

    expect(createOnboardingRunId()).toBe("abababababab");
  });

  it("still returns an id when web crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    const id = createOnboardingRunId();

    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});
