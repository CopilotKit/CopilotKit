# Documentation and Showcase defect register

Generated from `content-defects.json`. It is a reviewer index: the JSON remains the canonical record with every affected context and full evidence.

- Records: 36 (35 confirmed, 1 triaged, 0 candidate).
- Global unique-source review: 81/81 units reviewed; all 405 canonical routes and 978 represented frontend bindings are covered by the deduplicated source inventory.
- Local rendered-marker audit: 64 HTML paths and 112 impacted context cells. Frontend (38 supported / 74 not-declared) and backend (85 declared-wired / 24 unshipped / 3 manifest-unsupported) are overlapping dimensions, not additive totals.
- The supported-and-wired intersection is 29 cells. It is the scope for rendered Missing snippet defects; it neither promotes undeclared/unshipped cells nor negates the separately confirmed Google ADK source-resolution defect outside this probe subset.
- “External viewer” records describe a repository-ownership/context gap. They do not claim that the remote viewer is unavailable.

## Records

### CONTENT-GEN-001 — High · confirmed

The public Markdown endpoint and llms-full feed can tell a reader to implement a feature the corresponding browser guide explicitly marks unsupported, and can attribute another framework's example to the selected framework.

- **Area:** HTML/Markdown feature-availability parity
- **Affected frameworks:** LangGraph Python, LangGraph TypeScript, Google ADK, Built-in Agent, Strands, React (11 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/components/snippet.tsx:374`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/components/snippet.tsx:374), [`showcase/shell-docs/src/lib/llm-text.ts:515`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/lib/llm-text.ts:515)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-002 — High · confirmed

Readers following either Google ADK feature link get an HTML 200 representation titled only google-adk while the corresponding public Markdown endpoint is a 404. Neither representation delivers the ADK-specific setup and source contract advertised for manifest-wired demos.

- **Area:** guide source resolution
- **Affected frameworks:** Google ADK, React (2 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/integrations/google-adk/docs-links.json:52`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/integrations/google-adk/docs-links.json:52), [`tasks/docs-feature-audit/render-validation.md:54`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/render-validation.md:54)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-003 — High · confirmed

The browser presents an unqualified external demo/code source rather than the canonical Showcase cell, LangGraph TypeScript inherits a LangGraph viewer target, and Markdown/LLM readers receive JSX rather than runnable source.

- **Area:** canonical runnable examples and Markdown parity
- **Affected frameworks:** LangGraph Python, LangGraph TypeScript, Built-in Agent, Strands, LlamaIndex, Mastra, Microsoft Agent Framework .NET, Microsoft Agent Framework Python, Pydantic AI, AGNO, React Native, Vue, React (25 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/langgraph/generative-ui/your-components/interactive.mdx:6`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/langgraph/generative-ui/your-components/interactive.mdx:6), [`showcase/shell-docs/src/content/snippets/shared/generative-ui/interactive.mdx:3`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/snippets/shared/generative-ui/interactive.mdx:3)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-004 — Medium · confirmed

Readers can reach the pages through navigation but the feature catalog, showcase matrix, and feature-specific documentation links cannot discover or validate them as the guides for the wired feature IDs.

- **Area:** catalog-to-guide mapping
- **Affected frameworks:** LangGraph Python, LangGraph TypeScript, Google ADK, Built-in Agent, Strands, React (10 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/shared/feature-registry.json:443`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shared/feature-registry.json:443), [`tasks/docs-feature-audit/inventory.json:1`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/inventory.json:1)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-005 — Medium · triaged

Retain the raw count for audit history, but do not schedule a standalone fix from this record. Reader-facing work is limited to the separately confirmed Strands defects CONTENT-GEN-008 and CONTENT-GEN-009.

- **Area:** native setup contract and HTML/Markdown parity
- **Affected frameworks:** LangGraph Python, LangGraph TypeScript, Google ADK, Built-in Agent, Strands, React (35 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/scripts/bundle-setup-content.ts:3`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/scripts/bundle-setup-content.ts:3), [`showcase/shell-docs/src/lib/setup-concept.tsx:45`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/lib/setup-concept.tsx:45)
- **Resolution:** The raw 35 setup-fragment occurrences are fully classified: 30 require no additional package-owned setup, 1 is conditionally not rendered, 3 are promoted to CONTENT-GEN-009, and 1 is confirmed as CONTENT-GEN-008. This parent record preserves structural/history evidence only; it is not an open candidate or standalone repair target.
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-006 — Medium · confirmed

Built-in Agent readers are told the wrong hook supplies a named renderer, making the current API reference and feature guide contradict one another.

- **Area:** current API semantics
- **Affected frameworks:** Built-in Agent, React (4 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/snippets/shared/guides/default-tool-rendering.mdx:1`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/snippets/shared/guides/default-tool-rendering.mdx:1), [`showcase/shell-docs/src/content/snippets/shared/guides/default-tool-rendering.mdx:34`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/snippets/shared/guides/default-tool-rendering.mdx:34)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-007 — High · confirmed

Isolated local browser request capture confirms that changed controls are serialized in protocol context while forwardedProps is empty. The featured factory reads only forwardedProps, so it builds its default configuration prompt despite the control changes.

- **Area:** runnable example and native runtime-properties guidance
- **Affected frameworks:** Built-in Agent, React (1 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/integrations/built-in-agent/manifest.yaml:91`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/integrations/built-in-agent/manifest.yaml:91), [`tasks/docs-feature-audit/candidate-007-008-d6-assessment.md:30`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/candidate-007-008-d6-assessment.md:30)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-008 — High · confirmed

Audit-only direct execution of the registered state_context_builder confirms that a unique recipe sentinel is omitted from the constructed prompt, while a preferences control sentinel is retained. The promised recipe is therefore absent from the explicit state-to-model bridge.

- **Area:** runnable example behavior
- **Affected frameworks:** Strands, React (1 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/integrations/strands/src/app/demos/shared-state-read/page.tsx:69`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/integrations/strands/src/app/demos/shared-state-read/page.tsx:69), [`tasks/docs-feature-audit/candidate-007-008-d6-assessment.md:60`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/candidate-007-008-d6-assessment.md:60)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-009 — High · confirmed

A reader copying the generic React state/context calls has no Strands-native instruction for getting those values into the model, despite these cells relying on custom prompt lifting.

- **Area:** native backend setup guidance
- **Affected frameworks:** Strands, React (3 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/shared-state.mdx:42`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/shared-state.mdx:42), [`showcase/shell-docs/src/content/docs/shared-state/agent-readonly.mdx:41`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/shared-state/agent-readonly.mdx:41)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-010 — High · confirmed

The supported Built-in Agent A2UI guide visibly reports a missing source excerpt instead of presenting a copyable native implementation, while its opening classification also leaves readers without a stated Built-in Agent path. The Markdown route succeeds, so representation status alone masks the documentation failure.

- **Area:** framework-scoped snippet resolution
- **Affected frameworks:** Built-in Agent, React (1 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/integrations/built-in-agent/manifest.yaml:93`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/integrations/built-in-agent/manifest.yaml:93), [`tasks/docs-feature-audit/full-route-audit.md:73`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/full-route-audit.md:73)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-011 — Low · confirmed

The guide is still understandable, but the first explanation for this supported feature reads as unfinished and weakens the intended human-friendly documentation standard.

- **Area:** human-readable guide prose
- **Affected frameworks:** LangGraph Python, LangGraph TypeScript, React (2 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/langgraph/generative-ui/your-components/interactive.mdx:19`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/langgraph/generative-ui/your-components/interactive.mdx:19), [`showcase/shell-docs/src/content/docs/integrations/langgraph/generative-ui/your-components/interactive.mdx:45`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/langgraph/generative-ui/your-components/interactive.mdx:45)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-012 — Medium · confirmed

Readers follow an avoidable package-install step before using the selected feature-guide dependencies. This is a documentation-minimality issue only; the audit does not claim the package itself is nonworking or unsupported.

- **Area:** setup instruction minimality
- **Affected frameworks:** Google ADK, Built-in Agent, Strands, Mastra, AGNO, React (5 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx:227`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx:227), [`showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx:288`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx:288)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-013 — High · confirmed

The Google ADK frontend cannot start locally, so every Google ADK Showcase demo and corresponding guide that promises a runnable local example is unavailable before the page-specific feature behavior can be exercised. This is an observed launch failure, distinct from the source-only mismatch in CONTENT-GEN-007.

- **Area:** local Showcase guide/example availability
- **Affected frameworks:** Google ADK, React (2 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/integrations/google-adk/src/app/api/copilotkit-auth/route.ts:1`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/integrations/google-adk/src/app/api/copilotkit-auth/route.ts:1), [`tasks/docs-feature-audit/HOST-NATIVE-001.md:103`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/HOST-NATIVE-001.md:103)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-014 — High · confirmed

A reader who deploys these samples without an independent upstream identity guard allows a client to choose a user id and thus receives no actual per-user isolation from the shown callback. The guides make this unsafe interpretation likely by presenting it as the isolation mechanism.

- **Area:** quickstart thread authorization
- **Affected frameworks:** LangGraph Python, LangGraph TypeScript, Google ADK, Strands, LlamaIndex, Mastra, AGNO, React, Intelligence, Product guides (8 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx:376`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx:376), [`showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx:413`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx:413)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-015 — Medium · confirmed

The troubleshooting advice is nonportable: 0.0.0.0 denotes a server wildcard bind, not a portable client destination. It can send readers away from valid loopback URLs without the audit claiming an observed connection failure.

- **Area:** quickstart connection troubleshooting
- **Affected frameworks:** Google ADK, Strands, CrewAI Flows, LlamaIndex, Mastra, AGNO, React (7 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx:127`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx:127), [`showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx:210`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx:210)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-016 — Medium · confirmed

The public overview has a second Rich Threads coding-agent flow whose assumptions and verification language can drift from the CLI-owned add-rich-threads route. This conflicts with the requirement to reuse the existing helper rather than create another prompt contract.

- **Area:** Rich Threads setup-prompt ownership
- **Affected frameworks:** Threads, Product guides (1 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/snippets/shared/threads/overview.mdx:24`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/snippets/shared/threads/overview.mdx:24), [`showcase/shell-docs/src/lib/rich-threads-setup-prompt.ts:10`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/lib/rich-threads-setup-prompt.ts:10)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-017 — High · confirmed

The UI can initially load, then normal API route compilation overlays and returns 500. The first 18 LangGraph TypeScript D6 attempts launched this way are not valid behavior qualification, rather than passing or failing feature evidence.

- **Area:** local runnable Showcase default development command
- **Affected frameworks:** LangGraph TypeScript, React (1 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/integrations/langgraph-typescript/package.json:6`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/integrations/langgraph-typescript/package.json:6), [`tasks/docs-feature-audit/HOST-NATIVE-001.md:72`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/HOST-NATIVE-001.md:72)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-018 — Medium · confirmed

Copying the shown setup leaves ApprovalToolsService unconstructed, so registerHumanInTheLoop never runs and the agent receives no requestApproval browser tool.

- **Area:** Angular human-in-the-loop guide copy-paste registration
- **Affected frameworks:** Angular (1 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/frontends/angular/guides/human-in-the-loop.mdx:71`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/frontends/angular/guides/human-in-the-loop.mdx:71), [`packages/angular/src/lib/tools.ts:211`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/packages/angular/src/lib/tools.ts:211)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-019 — High · confirmed

Its supplied frontend does not send an Authorization request header, so the documented server gate rejects the request; it also teaches an unsafe/incorrect authentication transport boundary.

- **Area:** AG2 authentication guide current provider contract
- **Affected frameworks:** AG2, Vue, React (1 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/ag2/auth.mdx:38`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/ag2/auth.mdx:38), [`packages/react-core/src/v2/providers/CopilotKitProvider.tsx:131`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/packages/react-core/src/v2/providers/CopilotKitProvider.tsx:131)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-020 — High · confirmed

The supplied v2 TypeScript code rejects the string availability value and sends readers to the deprecated API reference, preventing a copy-paste frontend tool setup.

- **Area:** AG2 frontend-tools guide v2 API contract
- **Affected frameworks:** Mastra, AG2, Vue, React (2 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/ag2/frontend-tools.mdx:47`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/ag2/frontend-tools.mdx:47), [`showcase/shell-docs/src/content/docs/integrations/ag2/frontend-tools.mdx:57`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/ag2/frontend-tools.mdx:57)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-021 — High · confirmed

The guide’s primary in-chat example does not typecheck against the current v2 SDK, leaving readers without a runnable state-rendering implementation.

- **Area:** AG2 state-rendering guide current v2 state API
- **Affected frameworks:** CrewAI Flows, LlamaIndex, Mastra, AG2, Vue, React (4 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/ag2/generative-ui/state-rendering.mdx:107`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/ag2/generative-ui/state-rendering.mdx:107), [`packages/react-core/src/v2/hooks/use-agent.tsx:25`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/packages/react-core/src/v2/hooks/use-agent.tsx:25)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-022 — High · confirmed

The displayed named renderer does not satisfy the current hook overload and reads a nonexistent callback property, so the central example cannot typecheck or render the documented argument.

- **Area:** AG2 tool-rendering guide current v2 hook signature
- **Affected frameworks:** LlamaIndex, Mastra, AG2, AGNO, Vue, React (4 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/ag2/generative-ui/tool-rendering.mdx:86`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/ag2/generative-ui/tool-rendering.mdx:86), [`packages/react-core/src/v2/hooks/use-render-tool.tsx:77`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/packages/react-core/src/v2/hooks/use-render-tool.tsx:77)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-023 — Medium · confirmed

Readers who follow the guide are taken to a different API generation, making the setup less reliable and obscuring the actual v2 options.

- **Area:** AGNO frontend-tools guide API reference
- **Affected frameworks:** AGNO, Vue, React (1 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/agno/frontend-tools.mdx:44`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/agno/frontend-tools.mdx:44), [`packages/react-core/src/v2/hooks/use-frontend-tool.tsx:10`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/packages/react-core/src/v2/hooks/use-frontend-tool.tsx:10)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-024 — Medium · confirmed

New readers are anchored to an obsolete dependency range instead of receiving the current stable SDK through their package manager.

- **Area:** Claude SDK TypeScript quickstart dependency guidance
- **Affected frameworks:** CrewAI Flows, Angular, Vue, React (2 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/claude-sdk-typescript/quickstart.mdx:111`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/claude-sdk-typescript/quickstart.mdx:111), [`tasks/docs-feature-audit/content-defects.json:1`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json:1)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-025 — High · confirmed

The central implementation cannot typecheck against current v2 types and does not provide a current runnable human-decision registration.

- **Area:** CrewAI Flows human-in-the-loop guide current frontend contract
- **Affected frameworks:** CrewAI Flows, Vue, React (1 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/crewai-flows/human-in-the-loop/flow.mdx:66`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/crewai-flows/human-in-the-loop/flow.mdx:66), [`showcase/shell-docs/src/content/docs/integrations/crewai-flows/human-in-the-loop/flow.mdx:73`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/crewai-flows/human-in-the-loop/flow.mdx:73)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-026 — High · confirmed

The three local Showcase demonstrations cannot complete under the required strict fixture mode, so they do not provide reproducible evidence of their advertised behavior. The probes identify fixture coverage only; they do not establish a product runtime failure.

- **Area:** strict local Showcase fixture coverage
- **Affected frameworks:** Built-in Agent, React (3 recorded contexts)
- **Evidence:** local audit evidence
- **Primary links:** [`tasks/docs-feature-audit/built-in-agent-voice-browser-probe.json:28`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/built-in-agent-voice-browser-probe.json:28)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-027 — Medium · confirmed

Readers land on generic material or the .NET default route instead of the context-specific guide. The links are reachable; the defect is loss of the declared framework/variant context, not a missing-page claim.

- **Area:** framework guide navigation context
- **Affected frameworks:** Mastra, Microsoft Agent Framework .NET, Microsoft Agent Framework Harness .NET, Microsoft Agent Framework Python, React Native, Vue, React (3 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/mastra/human-in-the-loop/index.mdx:42`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/mastra/human-in-the-loop/index.mdx:42), [`showcase/shell-docs/src/content/docs/integrations/mastra/human-in-the-loop/index.mdx:49`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/mastra/human-in-the-loop/index.mdx:49)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-028 — High · confirmed

A .NET reader who copies the guide will double-bind the A2UI tool and disrupt tool selection; a single copy-paste recipe cannot serve both documented bindings.

- **Area:** cross-runtime A2UI setup guidance
- **Affected frameworks:** Microsoft Agent Framework .NET, Microsoft Agent Framework Python, React Native, Vue, React (2 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema.mdx:16`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema.mdx:16), [`showcase/integrations/ms-agent-dotnet/src/app/api/copilotkit-declarative-gen-ui/route.ts:27`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/integrations/ms-agent-dotnet/src/app/api/copilotkit-declarative-gen-ui/route.ts:27)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-029 — High · confirmed

The supplied frontend subscribes to sample_agent while the backend snippet defines search_agent; neither is a registered alias in the exact Showcase runtimes, so the documented state subscription cannot target the stated backend agent as presented.

- **Area:** state-rendering guide agent selection
- **Affected frameworks:** Microsoft Agent Framework .NET, Microsoft Agent Framework Python, React Native, Vue, React (1 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:320`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:320), [`showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:382`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:382)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-030 — Medium · confirmed

The Python route presents a .NET demonstration/context and cannot substantiate its own implementation path.

- **Area:** framework-specific interactive example selection
- **Affected frameworks:** Microsoft Agent Framework Python, React Native, Vue, React (1 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/interactive.mdx:8`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/interactive.mdx:8), [`showcase/shell-docs/src/content/snippets/shared/generative-ui/interactive.mdx:3`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/snippets/shared/generative-ui/interactive.mdx:3)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-031 — High · confirmed

The primary implementation block cannot run as the declared Pydantic AI backend file and does not give readers a usable state-rendering setup.

- **Area:** copy-paste guide language and API contract
- **Affected frameworks:** Pydantic AI, React Native, Vue, React (1 recorded contexts)
- **Evidence:** source/static analysis
- **Primary links:** [`showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx:38`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx:38), [`showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx:54`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx:54)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-032 — High · confirmed

Each affected fixed-schema guide visibly renders a Missing snippet callout in local HTML instead of the backend excerpt needed to implement its selected A2UI pattern.

- **Area:** framework-scoped fixed-schema source excerpts
- **Affected frameworks:** Strands TypeScript, AG2, AGNO, React (3 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/shell-docs/src/content/docs/generative-ui/a2ui/fixed-schema.mdx:177`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/generative-ui/a2ui/fixed-schema.mdx:177), [`tasks/docs-feature-audit/global-rendered-marker-triage.md:27`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/global-rendered-marker-triage.md:27)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-033 — Medium · confirmed

Four declared-supported/wired React reasoning contexts present a visible Missing snippet callout in place of their default configuration example.

- **Area:** reasoning-message source excerpt resolution
- **Affected frameworks:** Microsoft Agent Framework Harness .NET, Microsoft Agent Framework Python, React (4 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/shell-docs/src/content/docs/custom-look-and-feel/reasoning-messages.mdx:34`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/custom-look-and-feel/reasoning-messages.mdx:34), [`tasks/docs-feature-audit/global-rendered-marker-triage.md:49`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/global-rendered-marker-triage.md:49)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-034 — High · confirmed

Ten declared-supported/wired React contexts visibly omit the native state-streaming implementation and show a Missing snippet error, making the guides non-copyable at the key backend step.

- **Area:** state-streaming backend excerpt resolution
- **Affected frameworks:** LangGraph FastAPI, CrewAI Flows, Mastra, Microsoft Agent Framework .NET, Microsoft Agent Framework Python, React (10 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/shell-docs/src/content/docs/shared-state/streaming.mdx:50`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/shared-state/streaming.mdx:50), [`tasks/docs-feature-audit/global-rendered-marker-triage.md:61`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/global-rendered-marker-triage.md:61)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-035 — Medium · confirmed

The four declared-supported/wired React headless contexts visibly show Missing snippet instead of the central custom-chat implementation.

- **Area:** headless guide frontend excerpt resolution
- **Affected frameworks:** Microsoft Agent Framework Harness .NET, Microsoft Agent Framework Python, React (4 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/shell-docs/src/content/docs/headless.mdx:50`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/headless.mdx:50), [`tasks/docs-feature-audit/global-rendered-marker-triage.md:103`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/global-rendered-marker-triage.md:103)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)

### CONTENT-GEN-036 — High · confirmed

Seven declared-supported/wired React tool-rendering contexts display Missing snippet where the native backend tool definition should appear.

- **Area:** tool-rendering backend excerpt resolution
- **Affected frameworks:** Strands TypeScript, Microsoft Agent Framework Harness .NET, React (7 recorded contexts)
- **Evidence:** source + local audit evidence
- **Primary links:** [`showcase/shell-docs/src/content/docs/generative-ui/tool-rendering.mdx:111`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/shell-docs/src/content/docs/generative-ui/tool-rendering.mdx:111), [`tasks/docs-feature-audit/global-rendered-marker-triage.md:115`](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/global-rendered-marker-triage.md:115)
- **Full record:** [`content-defects.json` entry](/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit/content-defects.json)
