# Sources

Files and references used to generate this skill. Generated: 2026-05-27

## SKILL.md / assets/daytona-runcode-tool.ts

- docs/content/docs/cookbook/daytona.mdx (the Daytona cookbook recipe — the `runCode` tool, validated end
  to end against published `@copilotkit/runtime@1.58.0`)
- @copilotkit/runtime@1.58.0 `/v2` exports (BuiltInAgent, defineTool, CopilotRuntime) — verified from the
  published package's type declarations
- skills/copilotkit-setup/ (skill format, frontmatter, and structure this skill mirrors)

## references/daytona-sandboxes.md

- @daytonaio/sdk TypeScript SDK reference: Daytona client, create({ language }), process.codeRun,
  process.executeCommand, sandbox lifecycle (stop/start/delete), getPreviewLink, Image builder
- Daytona platform docs: code-execution languages (python/typescript/javascript), network tiers
  (Tier 1/2 restricted egress + whitelist; Tier 3+ unrestricted), https://www.daytona.io/docs

## eval.yaml / workspace/builtin-agent-app

- skills/copilotkit-setup/eval.yaml (eval format: docker provider, deterministic + llm_rubric graders)
- A minimal Built-in Agent runtime route (createCopilotEndpointSingleRoute + BuiltInAgent) used as the
  starting fixture the skill modifies
