# Generation and representation repair log

## C001 — unsupported-state parity in raw Markdown

### Scope

- Source: `showcase/shell-docs/src/lib/llm-text.ts`
- Focused regression coverage: `showcase/shell-docs/src/lib/__tests__/llm-text.test.ts`
- Baseline revision: `b0079629eae9445f82cae66baf674c091da971ad`

### Before

The HTML `Snippet` component reads the generated catalog and displays the supported/unsupported state. The raw Markdown renderer used only bundled demos, so an unsupported scoped page emitted the interactive-demo comment or code instead of the HTML unsupported notice.

Because the test was introduced with this repair, the before result was reconstructed by applying only the implementation diff in reverse while retaining the test assertions, then restoring it immediately. Command:

```sh
npm --prefix showcase/shell-docs test -- --run src/lib/__tests__/llm-text.test.ts -t 'matches the HTML unsupported state'
```

Result: 3 failed / 46 skipped. The failing cells were LangGraph Python interactive generative UI, AWS Strands Python state streaming, and Built-in Agent headless interrupts. Each Markdown result lacked the expected `Not supported on …` notice.

### After

The raw renderer now resolves catalog state before loading a snippet or expanding an inline demo and emits the same framework-specific unsupported notice as HTML.

The same focused command passed: 3 passed / 46 skipped. Full pretest generation also completed (21 integrations, 1,029 catalog cells, 802 demo bundles).

### Unrelated current-worktree failure

A full `llm-text` suite run has one pre-existing-or-concurrent-content failure: the Mastra canonical tool-rendering expectation for `import { createTool } from "@mastra/core/tools";`. It is outside the C001 assertions and overlaps a concurrently modified, content-agent-owned shared tool-rendering snippet. It is deliberately not changed in this lane; its baseline origin remains to be confirmed from an isolated checkout.
