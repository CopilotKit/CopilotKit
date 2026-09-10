# Microsoft Agent Framework and Pydantic AI source review

All pending Microsoft Agent Framework and Pydantic AI guide source units from global-pending-source-units.json. Local/source review only; external iframe destinations were not fetched.

- Units reviewed: 22.
- Bound cells represented: 169.
- Statuses: confirmed-context-defect=2, confirmed-copy-paste-defect=2, context-gap=5, reviewed-no-new-defect=13.

## Confirmed source findings

- `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema.mdx` — The shared guide instructs every mapped MAF context to use auto-injection, but the checked-in .NET runtime explicitly requires injectA2UITool false while the Python runtime uses true. The page needs a per-agent distinction before it can be copyable for both bindings.
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema.mdx:16-27`
  - `showcase/integrations/ms-agent-dotnet/src/app/api/copilotkit-declarative-gen-ui/route.ts:3-5`
  - `showcase/integrations/ms-agent-dotnet/src/app/api/copilotkit-declarative-gen-ui/route.ts:27-39`
  - `showcase/integrations/ms-agent-python/src/app/api/copilotkit-declarative-gen-ui/route.ts:33-45`
- `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx` — The backend examples name search_agent while both frontend useAgent examples select sample_agent, so the supplied frontend will not subscribe to the documented agent. The demo is also an external .NET viewer for a page mapped to Python; that context gap is recorded separately from the copy-paste failure.
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:320`
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:382`
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:426`
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:7-14`
- `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/interactive.mdx` — This unit maps to ms-agent-python as well as .NET, but hard-codes the .NET Feature Viewer framework argument. The Python route therefore cannot present its own exact demo/context.
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/interactive.mdx:6-8`
  - `showcase/shell-docs/src/content/snippets/shared/generative-ui/interactive.mdx:3-10`
- `showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx` — The first implementation fence is declared Python agent.py but contains TypeScript/JSX and useAgent; it cannot run as presented. Its iframe also points to LangGraph, so it is not Pydantic AI evidence.
  - `showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx:7-14`
  - `showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx:34-71`

## Context gaps

- `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/frontend-tools.mdx` — The guide is bound to both .NET and Python cells but its only demo/code surface is an external .NET Feature Viewer. It supplies no local exact Python binding; external content was intentionally not fetched.
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/frontend-tools.mdx:6-14`
  - `showcase/shell-docs/src/content/snippets/integrations/microsoft-agent-framework/run-and-connect.mdx:10-17`
- `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/tool-rendering.mdx` — The only demo and code links are external Feature Viewer URLs, despite the local guide being mapped to .NET and Python. This is recorded as unverified external presentation, not an asserted remote outage.
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/tool-rendering.mdx:7-28`
- `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/human-in-the-loop/index.mdx` — The cards use unscoped root URLs, which resolve outside the mapped MAF integration context. Treat as context loss, not a missing-page claim.
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/human-in-the-loop/index.mdx:19-36`
- `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/quickstart.mdx` — The quickstart is shared by .NET, harness .NET, and Python, but its next-step cards use the unscoped microsoft-agent-framework path. Local redirect verification sends that family path to the .NET quickstart, so Python/harness context is lost.
  - `showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/quickstart.mdx:522-540`
  - `showcase/shell-docs/src/content/snippets/integrations/microsoft-agent-framework/run-and-connect.mdx:10-17`
- `showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/tool-rendering.mdx` — The Pydantic AI guide embeds and describes LangGraph Feature Viewer URLs rather than a Pydantic AI example. Remote viewer availability was not requested or asserted.
  - `showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/tool-rendering.mdx:12-23`
