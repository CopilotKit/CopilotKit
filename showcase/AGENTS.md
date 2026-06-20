# Showcase Methodology

The showcase is CopilotKit's proving ground for dev-user-visible product work. In this monorepo its source lives under `showcase/`. In other CopilotKit contexts, showcase may live in a private CopilotKit org repo; if you have access, use it, and if you do not have access, these showcase-specific steps do not apply beyond noting the limitation.

Use showcase for almost all CopilotKit feature work that affects dev-user-visible or end-user-visible behavior. Some deployed showcase environments and promotion steps may require CopilotKit employee access; when that access is unavailable, do the local showcase work you can and call out the limitation.

## Users

Every showcase row should be evaluated for two users:

- **dev-user**: the developer learning or copying the CopilotKit implementation for their own app.
- **end-user**: the person using the app built with that implementation.

The dev-user needs clear code, docs chunks, predictable APIs, and passing tests. The end-user needs a UI flow that feels useful, reliable, and polished.

## Row-First Workflow

When adding a feature, add or update a showcase row for that feature.

Start with one complete implementation in the LangGraph Python / LangChain Deep Agents column. Get that implementation working at high quality first. After the first column is solid, use parallel subagents to port the same row to the other columns.

Not every low-level helper deserves its own row. If an API is normally used inside a larger workflow, show it inside that workflow. Prefer updating the row where a dev-user would naturally encounter it over creating an isolated workbench for an implementation detail.

Do not treat showcase as just app code. A complete row includes:

- the runnable implementation
- end-to-end tests
- realistic data and fixtures
- code chunk highlights used by docs
- docs snippets or references that explain the implementation
- any registry or manifest updates needed for the row to appear correctly

Matrix completeness means every integration column that supports the feature, not only LangGraph Python.

## Dev-User Code

Showcase demo code is dev-user-visible product surface. It should be minimal, idiomatic application code that a developer could reasonably copy into their own app.

For dev-user-visible functions, hooks, components, props, config keys, or package exports, show the proposed code snippets before implementation. If multiple names, argument structures, or placements are reasonable, propose a few options with tradeoffs and a recommendation. The snippet a dev-user writes is the product.

Do not hardcode AG-UI protocol objects, fake `ToolCall` / `ToolMessage` values, or construct internal message shapes in app code unless the feature specifically teaches protocol internals. Real showcase app code should get messages, state, tool calls, and results from the actual CopilotKit flow.

When a test needs determinism, mock the transport at the boundary with realistic events or fixtures. Do not move fake protocol objects into the demo implementation to make the test easier.

## End-To-End Tests

Showcase e2e tests should exercise realistic user journeys:

- open the actual demo route
- click, type, submit, approve, or otherwise interact like an end-user
- drive the CopilotKit/agent-visible flow far enough to prove the feature
- assert the user-visible result, not just that the page loaded

Avoid TODO smoke tests that only check the route and a generic assistant response. If the real backend requires secrets or external services, use a deterministic but realistic transport stream or fixture so the browser still exercises the same dev-user app code.

## Use-It-For-Real Loop

Work in loops:

1. Code the feature.
2. Run showcase locally or on the staging showcase environment.
3. Use the feature in the browser like a real dev-user or end-user would: click around, type, trigger the agent, inspect intermediate states, and exercise the workflow in depth.
4. Fix what that usage reveals.
5. Re-run the relevant tests and browser flow.

Shallow smoke tests are not enough for showcase work. The point of showcase is to catch the product and documentation problems that only appear when someone actually uses the feature.

## Staging Before Production

All showcase validation happens against the staging showcase environment. Promoting showcase changes to production is a separate explicit step and should not be bundled into ordinary feature work unless the user asks for it.
