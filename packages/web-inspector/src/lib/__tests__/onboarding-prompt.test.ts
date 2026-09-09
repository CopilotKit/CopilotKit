import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEATURE_ONBOARDING_INTENT,
  FEATURE_ONBOARDING_PROMPT_TEMPLATE,
  ONBOARDING_INTENTS,
  ONBOARDING_PROMPT_TEMPLATE,
  createFeatureOnboardingPrompt,
  createOnboardingPrompt,
  createOnboardingRunId,
} from "../onboarding-prompt.js";
import { buildHomeModel } from "../home-briefing.js";
import { projectInspectorMetadata } from "../inspector-metadata.js";

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

describe("feature onboarding intents", () => {
  it("names one intent for every Home feature tile, and every intent once", () => {
    // The two sets are held equal in both directions on purpose. A new tile
    // with no intent leaves a button that cannot reach the graph; an intent
    // no tile names is a route with no caller, which is the whole of
    // OSS-1150.
    const tiles = buildHomeModel({
      intelligenceConnected: false,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(undefined, undefined),
      runtimeConnectionState: "unavailable",
      learningOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
    }).services.map((service) => service.id);

    expect(Object.keys(FEATURE_ONBOARDING_INTENT).sort()).toEqual(
      [...tiles].sort(),
    );
    expect(Object.values(FEATURE_ONBOARDING_INTENT).sort()).toEqual(
      [...ONBOARDING_INTENTS].sort(),
    );
  });

  it("keeps the slugs the CLI graph exposes", () => {
    // Byte-equal to ONBOARDING_INTENT_ROOTS in Intelligence's
    // apps/cli/onboarding-intents.cjs. The repositories cannot import each
    // other, so this list is the agreement.
    expect([...ONBOARDING_INTENTS]).toEqual([
      "add-a2ui",
      "add-chat-suggestions",
      "add-learning",
      "add-open-generative-ui",
      "add-realtime-sync",
      "add-rich-threads",
      "add-voice",
    ]);
  });

  it("maps the Learning tile to the Learning route, not to Threads", () => {
    // The tile id and the `memories` menu key are older names for the pane
    // that `learningOn` gates on a configured Learning container, which is
    // what feature/learning sets up.
    expect(FEATURE_ONBOARDING_INTENT.memory).toBe("add-learning");
    expect(FEATURE_ONBOARDING_INTENT.threads).toBe("add-rich-threads");
  });

  it("sends the coding agent to one feature route and nothing else", () => {
    const prompt = createFeatureOnboardingPrompt("a2ui", "abc123def456");

    expect(prompt).toContain(
      "npx --yes copilotkit@latest onboard start --run abc123def456 --coding-agent <coding-agent-slug> --intent add-a2ui",
    );
    expect(prompt).not.toContain("<run-id>");
    expect(prompt).not.toContain("<intent>");
    // The agent-slug placeholder is the coding agent's to fill, so it stays.
    expect(prompt).toContain("<coding-agent-slug>");
  });

  it("carries no feature-specific instruction of its own", () => {
    // Everything below belonged to the prose this prompt replaced. The route
    // owns it now, and a copied paragraph would drift from it.
    for (const serviceId of Object.keys(
      FEATURE_ONBOARDING_INTENT,
    ) as (keyof typeof FEATURE_ONBOARDING_INTENT)[]) {
      const prompt = createFeatureOnboardingPrompt(serviceId, "abc123def456");

      expect(prompt).not.toContain("This task is specifically to enable");
      expect(prompt).not.toContain("docs.copilotkit.ai");
      expect(prompt).not.toContain(" guide");
      expect(prompt).not.toContain(" plan");
      expect(prompt).not.toContain("focused tests");
      expect(prompt).not.toContain("smallest complete integration");
      expect(prompt).not.toContain("not merely that the code compiles");
    }
  });

  it("keeps the placeholders the template promises", () => {
    expect(FEATURE_ONBOARDING_PROMPT_TEMPLATE).toContain("<run-id>");
    expect(FEATURE_ONBOARDING_PROMPT_TEMPLATE).toContain("<intent>");
  });
});
