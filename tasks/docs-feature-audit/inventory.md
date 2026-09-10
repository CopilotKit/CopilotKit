# Feature-guide audit inventory

Generated audit evidence only. It does not modify product docs, manifests, generated data, or runtime results.

## Baseline

- Source revision: `fa6041fc7b08fc5866099769038e43c44c1ce8df`
- Audit workspace head: `9ab8079fdb4de0ee3b062f0aced055e3f4541bf6` (audit-artifact commit only).
- Five-agent React matrix: 220 cells (langgraph-python, langgraph-typescript, google-adk, strands, built-in-agent × 44 active feature records).
- Manifest declarations account for 187 feature outcomes before unsupported, absent, and demo-only reconciliation.
- Runtime status is intentionally `not_run` for every cell until local-harness evidence is attached.
- `wired`, `stub`, `unshipped`, and `unsupported` are manifest/catalog declarations, never pass results.

## Source-resolution validation

- Selected-framework source bindings mirror the router's authored/generated precedence, docs-folder aliases, and special quickstart/threads-import override handling.
- Canonical component routes render directly; historical redirect aliases do not replace the canonical routes in this inventory.
- Results: 193 selected cells resolve an effective MDX source; 17 have no source for the selected framework; 10 have no taxonomy guide mapping. These are coverage findings, not runtime or editorial defect verdicts.

## Guide inventory

- 44 active taxonomy features collapse into 31 canonical catalog-guide routes.
- Missing feature-guide mappings: declarative-hashbrown, declarative-json-render.
- Product-guide outline: 26 root source units across Threads, Intelligence, and Channels.

| Canonical route                               | Feature IDs                                                                                                       | Root source                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/agent-config`                               | `agent-config`                                                                                                    | `showcase/shell-docs/src/content/docs/agent-config.mdx`                            |
| `/agentic-chat-ui`                            | `beautiful-chat, agentic-chat`                                                                                    | `showcase/shell-docs/src/content/docs/agentic-chat-ui.mdx`                         |
| `/auth`                                       | `auth`                                                                                                            | `showcase/shell-docs/src/content/docs/auth.mdx`                                    |
| `/background-tasks`                           | `background-agents`                                                                                               | `no root MDX (framework context may resolve)`                                      |
| `/browser-use`                                | `browser-use`                                                                                                     | `no root MDX (framework context may resolve)`                                      |
| `/custom-look-and-feel/css`                   | `chat-customization-css`                                                                                          | `showcase/shell-docs/src/content/docs/custom-look-and-feel/css.mdx`                |
| `/custom-look-and-feel/reasoning-messages`    | `reasoning-default, reasoning-custom`                                                                             | `showcase/shell-docs/src/content/docs/custom-look-and-feel/reasoning-messages.mdx` |
| `/custom-look-and-feel/slots`                 | `chat-slots`                                                                                                      | `showcase/shell-docs/src/content/docs/custom-look-and-feel/slots.mdx`              |
| `/frontend-tools`                             | `frontend-tools, frontend-tools-async, threadid-frontend-tool-roundtrip`                                          | `showcase/shell-docs/src/content/docs/frontend-tools.mdx`                          |
| `/generative-ui/a2ui/dynamic-schema`          | `declarative-gen-ui, a2ui-recovery`                                                                               | `showcase/shell-docs/src/content/docs/generative-ui/a2ui/dynamic-schema.mdx`       |
| `/generative-ui/a2ui/fixed-schema`            | `a2ui-fixed-schema`                                                                                               | `showcase/shell-docs/src/content/docs/generative-ui/a2ui/fixed-schema.mdx`         |
| `/generative-ui/mcp-apps`                     | `mcp-apps`                                                                                                        | `showcase/shell-docs/src/content/docs/generative-ui/mcp-apps.mdx`                  |
| `/generative-ui/open-generative-ui`           | `open-gen-ui, open-gen-ui-advanced`                                                                               | `showcase/shell-docs/src/content/docs/generative-ui/open-generative-ui.mdx`        |
| `/generative-ui/state-rendering`              | `gen-ui-agent`                                                                                                    | `showcase/shell-docs/src/content/docs/generative-ui/state-rendering.mdx`           |
| `/generative-ui/tool-rendering`               | `tool-rendering-default-catchall, tool-rendering-custom-catchall, tool-rendering, tool-rendering-reasoning-chain` | `showcase/shell-docs/src/content/docs/generative-ui/tool-rendering.mdx`            |
| `/generative-ui/your-components/display-only` | `gen-ui-tool-based`                                                                                               | `no root MDX (framework context may resolve)`                                      |
| `/generative-ui/your-components/interactive`  | `hitl-in-chat`                                                                                                    | `no root MDX (framework context may resolve)`                                      |
| `/headless`                                   | `headless-simple, headless-complete`                                                                              | `showcase/shell-docs/src/content/docs/headless.mdx`                                |
| `/human-in-the-loop`                          | `hitl-in-app`                                                                                                     | `showcase/shell-docs/src/content/docs/human-in-the-loop/index.mdx`                 |
| `/human-in-the-loop/headless`                 | `interrupt-headless`                                                                                              | `showcase/shell-docs/src/content/docs/human-in-the-loop/headless.mdx`              |
| `/human-in-the-loop/useInterrupt`             | `gen-ui-interrupt`                                                                                                | `showcase/shell-docs/src/content/docs/human-in-the-loop/useInterrupt.mdx`          |
| `/multi-agent/subagents`                      | `subagents`                                                                                                       | `showcase/shell-docs/src/content/docs/multi-agent/subagents.mdx`                   |
| `/multimodal-attachments`                     | `multimodal`                                                                                                      | `showcase/shell-docs/src/content/docs/multimodal-attachments.mdx`                  |
| `/observational-memory`                       | `observational-memory`                                                                                            | `no root MDX (framework context may resolve)`                                      |
| `/prebuilt-components/popup`                  | `prebuilt-popup`                                                                                                  | `showcase/shell-docs/src/content/docs/prebuilt-components/popup.mdx`               |
| `/prebuilt-components/sidebar`                | `prebuilt-sidebar`                                                                                                | `showcase/shell-docs/src/content/docs/prebuilt-components/sidebar.mdx`             |
| `/quickstart`                                 | `cli-start`                                                                                                       | `showcase/shell-docs/src/content/docs/quickstart.mdx`                              |
| `/shared-state`                               | `shared-state-read-write, shared-state-read`                                                                      | `showcase/shell-docs/src/content/docs/shared-state.mdx`                            |
| `/shared-state/agent-readonly`                | `readonly-state-agent-context`                                                                                    | `showcase/shell-docs/src/content/docs/shared-state/agent-readonly.mdx`             |
| `/shared-state/streaming`                     | `shared-state-streaming`                                                                                          | `showcase/shell-docs/src/content/docs/shared-state/streaming.mdx`                  |
| `/voice`                                      | `voice`                                                                                                           | `showcase/shell-docs/src/content/docs/voice.mdx`                                   |

## Selected integrations

| Slug                   | Docs mode | Docs folder      | Declared features | Routed demos | AIMock files |
| ---------------------- | --------- | ---------------- | ----------------: | -----------: | -----------: |
| `langgraph-python`     | generated | `langgraph`      |                38 |           39 |           43 |
| `langgraph-typescript` | generated | `langgraph`      |                38 |           39 |           43 |
| `google-adk`           | generated | `adk`            |                38 |           38 |           41 |
| `strands`              | generated | `aws-strands`    |                36 |           39 |           42 |
| `built-in-agent`       | authored  | `built-in-agent` |                37 |           39 |           40 |

## Required status interpretation

- `release-quarantine`: LangGraph Python and TypeScript interrupt cells explicitly marked unsupported pending a published react-core fix.
- `manifest-unsupported`: capability is declared unsupported by that integration; it is not a runtime pass/fail assertion.
- `declared-wired-unverified`: the manifest declares a routed demo, but no local evidence has yet confirmed it.
- D6 runs execute integration-wide manifest demo sets, not a one-to-one feature fixture matrix. Fixture files are deliberately kept as integration-level evidence because their filenames are not a declared feature binding.

## Reproduction contract

Use the integration-wide local runner contract supplied by the harness audit:

```text
showcase/bin/showcase test <slug> --d6 --direct --isolate <unique> --verbose --cycle
```

Record the resulting log/artifact path and exact tested demo IDs in `runtime_evidence` before changing `runtime_status`.
