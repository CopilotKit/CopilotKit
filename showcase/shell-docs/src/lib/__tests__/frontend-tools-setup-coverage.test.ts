import { expect, test } from "vitest";

import setupContentData from "@/data/setup-content.json";
import { getIntegrations } from "../registry";
import { resolveBundledSetupConcept } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";

const setupContent = setupContentData as SetupContentBundle;
const CONCEPT = "frontend-tools-setup";

/**
 * Frameworks whose `frontend-tools-setup` requirement has not been established yet.
 *
 * `generative-ui/tool-based` is the terminal page every onboarding run fetches
 * (OSS-1034), and its `## How it works in code` section is this concept. Where the
 * concept is unbundled the section renders nothing, and nothing distinguishes "this
 * framework needs no agent-side wiring" from "it needs some and nobody wrote it down"
 * (OSS-1036).
 *
 * Every name here is unfinished work, not an exemption on the merits. Establishing the
 * answer means reading the framework's AG-UI adapter and its own `gen-ui-tool-based`
 * demo agent, then writing the snippet — including when the snippet's content is
 * "nothing is required", which is a real and common answer worth stating.
 *
 * Removing a name is the whole job. Adding one needs a reason in the pull request.
 */
const REQUIREMENT_NOT_ESTABLISHED = [
  "ag2",
  "agno",
  "built-in-agent",
  "deepagents",
  "mastra",
  "ms-agent-dotnet",
  "ms-agent-harness-dotnet",
  "strands",
  "strands-typescript",
] as const;

function frameworksServingToolBased(): string[] {
  return getIntegrations()
    .filter((integration) => integration.docs_mode !== "hidden")
    .map((integration) => integration.slug)
    .sort();
}

test("every framework either documents its frontend-tool requirement or is a named gap", () => {
  const missing = frameworksServingToolBased().filter(
    (slug) =>
      resolveBundledSetupConcept(slug, CONCEPT, setupContent) === null &&
      !REQUIREMENT_NOT_ESTABLISHED.includes(
        slug as (typeof REQUIREMENT_NOT_ESTABLISHED)[number],
      ),
  );

  expect(
    missing,
    `these frameworks serve generative-ui/tool-based with no frontend-tools-setup snippet and are not on the known-gap list. Either write the snippet or add the slug to REQUIREMENT_NOT_ESTABLISHED with a reason`,
  ).toEqual([]);
});

test("the known-gap list holds no framework that has since been documented", () => {
  const documented = REQUIREMENT_NOT_ESTABLISHED.filter(
    (slug) => resolveBundledSetupConcept(slug, CONCEPT, setupContent) !== null,
  );

  expect(
    documented,
    "these frameworks now bundle frontend-tools-setup, so remove them from REQUIREMENT_NOT_ESTABLISHED",
  ).toEqual([]);
});

// The two shapes the bundled snippets have to keep apart. A framework whose adapter
// forwards the tools on its own still needs the model told to call the component --
// omitting that is why an agent answers in prose and the component never renders -- and a
// framework that owns its model call has to hand the tools over itself.
test("a snippet says what the framework's own demo agent proves about it", () => {
  const forwardsAutomatically = [
    "pydantic-ai",
    "llamaindex",
    "ms-agent-python",
  ];
  for (const slug of forwardsAutomatically) {
    const source = resolveBundledSetupConcept(slug, CONCEPT, setupContent);
    expect(source, slug).not.toBeNull();
    expect(source, `${slug}: says there is nothing to wire`).toMatch(
      /Nothing to wire on the agent/,
    );
    expect(source, `${slug}: still requires instructing the model`).toMatch(
      /Tell the model when to call it/,
    );
  }

  // A CrewAI Flow owns its own model call, so the tools do not reach the model unless the
  // Flow passes them. `tool_choice` is the lever it has and a chat agent does not. Only
  // `crewai-crews` is checked: `crewai-conversational-flows` is `docs_mode: hidden`, so a
  // snippet written for it would never be served.
  for (const slug of ["crewai-crews"]) {
    const source = resolveBundledSetupConcept(slug, CONCEPT, setupContent);
    expect(source, slug).not.toBeNull();
    expect(source, `${slug}: reads the forwarded tools off state`).toContain(
      "state.copilotkit.actions",
    );
    expect(source, `${slug}: hands them to the model`).toContain(
      "tools=actions",
    );
    expect(
      source,
      `${slug}: streams so the call reaches the browser`,
    ).toContain("copilotkit_stream");
    expect(source, `${slug}: names the tool_choice lever`).toContain(
      "tool_choice",
    );
  }
});
