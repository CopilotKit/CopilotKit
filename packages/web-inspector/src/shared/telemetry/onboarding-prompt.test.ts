import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_PROMPT_TEMPLATE,
  createOnboardingPrompt,
  createOnboardingRunId,
} from "../../shell/window/onboarding-prompt.js";

describe("onboarding-prompt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the CLI entry point the graph resolves", () => {
    // If this string drifts, the copied prompt sends the coding agent to a
    // command the CLI does not expose and onboarding dead-ends silently.
    expect(ONBOARDING_PROMPT_TEMPLATE).toContain(
      "npx --yes copilotkit@latest onboard start --run <run-id> --coding-agent <coding-agent-slug>",
    );
  });

  it("substitutes the run id and leaves no placeholder behind", () => {
    const prompt = createOnboardingPrompt("abc123def456");

    expect(prompt).toContain("--run abc123def456");
    expect(prompt).not.toContain("<run-id>");
    // The agent-slug placeholder is the coding agent's to fill, so it stays.
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

    expect(createOnboardingRunId()).toBe("ababababababab".slice(0, 12));
  });

  it("still returns an id when no web crypto is available", () => {
    // The Inspector is embedded in other people's pages, so neither a secure
    // context nor a modern crypto surface is guaranteed. A missing id would
    // break the copy button; a weak one only weakens correlation.
    vi.stubGlobal("crypto", undefined);

    const id = createOnboardingRunId();

    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});
