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
 * The list is empty: every framework serving the page now states its requirement.
 * Keep it that way. A new framework arriving without a snippet fails the first test
 * below, and the fix is the snippet, not a name here. Adding one needs a reason in the
 * pull request, and it is unfinished work rather than an exemption on the merits.
 */
const REQUIREMENT_NOT_ESTABLISHED: readonly string[] = [] as const;

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
      !REQUIREMENT_NOT_ESTABLISHED.includes(slug),
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
    // Added by OSS-1036. Each verdict was read out of the pinned adapter, not the
    // docs: ag2 `run_stream` builds `client_tools` from `incoming.tools`; the Mastra
    // adapter reduces `input.tools` into `clientTools` for `agent.stream()`; both
    // Strands adapters register a proxy tool per forwarded tool in the agent's tool
    // registry. The two .NET columns rest on their own demo agents, which render
    // charts with an empty `tools` list, because no .NET SDK was available to read
    // `Microsoft.Agents.AI.Hosting.AGUI.AspNetCore` directly.
    "ag2",
    "mastra",
    "strands",
    "strands-typescript",
    "ms-agent-dotnet",
    "ms-agent-harness-dotnet",
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

  // Deep Agents compile to LangGraph graphs, so the forwarded tools reach the model
  // only through `CopilotKitMiddleware`, which merges `copilotkit.actions` into
  // `request.tools` in `wrap_model_call`. Drop the middleware and the run still
  // succeeds while the component never renders, which is the exact failure an empty
  // section used to hide.
  {
    const source = resolveBundledSetupConcept(
      "deepagents",
      CONCEPT,
      setupContent,
    );
    expect(source, "deepagents").not.toBeNull();
    expect(source, "deepagents: names the bridge").toContain(
      "CopilotKitMiddleware()",
    );
    expect(source, "deepagents: puts it in the middleware list").toContain(
      "middleware=[",
    );
  }

  // Agno is the one framework here whose AG-UI interface never reads
  // `RunAgentInput.tools` (checked against agno 2.6.19: the only tool path out of
  // `agno/os/interfaces/agui` is `RunPausedEvent.tools_awaiting_external_execution`).
  // So the component needs a declared stub, and the paused run needs somewhere to live.
  {
    const source = resolveBundledSetupConcept("agno", CONCEPT, setupContent);
    expect(source, "agno").not.toBeNull();
    expect(
      source,
      "agno: declares the component as an external tool",
    ).toContain("external_execution=True");
    expect(source, "agno: gives the paused run a database").toContain("db=db");
  }

  // The built-in agent is the only mode-dependent answer, and it is also the root
  // framework, so this snippet is what the unscoped default page renders. Config mode
  // merges `input.tools` for you; a factory owns the model call and forwards nothing.
  // Saying only one half would be wrong for half the readers.
  {
    const source = resolveBundledSetupConcept(
      "built-in-agent",
      CONCEPT,
      setupContent,
    );
    expect(source, "built-in-agent").not.toBeNull();
    expect(source, "built-in-agent: config mode needs no wiring").toContain(
      "Nothing to wire in config mode",
    );
    expect(source, "built-in-agent: factory mode passes them itself").toContain(
      "convertToolsToVercelAITools(input.tools)",
    );
  }
});
