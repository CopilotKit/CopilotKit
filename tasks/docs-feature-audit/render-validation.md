# Local shell-docs render validation

## Scope and provenance

- Product source snapshot: `fa6041fc7b08fc5866099769038e43c44c1ce8df`.
- A disposable detached worktree at `/private/tmp/copilotkit-shell-docs-render-audit` held all
  dependency installation, generated output, server state, and temporary logs. The repository
  source and canonical generated data were not changed.
- Runtime: Node `v23.7.0`, npm `10.9.2`, shell-docs package `0.1.0`, Next `16.2.6`.
- The canonical local shell-docs build path is `npm run build`; its lifecycle generates the
  registry, demo/setup content, and search data before the build. See
  `showcase/shell-docs/README.md:27-42`.

## Commands and build outcome

The disposable worktree ran these commands:

```text
npm --prefix showcase/shell-docs ci
npm --prefix showcase/scripts ci
npm --prefix showcase/shell-docs run build
cd showcase/shell-docs && ./node_modules/.bin/next start -p 3103
```

The build passed. Its generation completed, then Next compiled and emitted 227 static pages.
It warned that the custom-route count exceeds 1,000 and that the middleware convention is
deprecated. The isolated install emitted Node-engine warnings because this shell was Node 23;
neither condition failed the build. No provider credentials or hosted demos were used.

## Rendered HTTP sample

The local production server was started only for each probe batch and stopped immediately after.
The sample covers five selected agent contexts, eight guide paths per context, and both public
HTML and `.mdx` representations: 80 final route representations. The route list is
`quickstart`, `generative-ui/your-components/{display-only,interactive}`, `background-tasks`,
`browser-use`, `observational-memory`, and `human-in-the-loop/{headless,useInterrupt}`.

| Context              | Final 200 representations | Final 404 representations | Redirect behavior                                     |
| -------------------- | ------------------------: | ------------------------: | ----------------------------------------------------- |
| LangGraph Python     |                        11 |                         5 | Direct                                                |
| LangGraph TypeScript |                        11 |                         5 | Direct                                                |
| Google ADK           |                         9 |                         7 | Direct                                                |
| Strands              |                        11 |                         5 | Direct                                                |
| Built-in Agent       |                        10 |                         6 | Every scoped sample begins with 308 to the root route |
| **Total**            |                    **52** |                    **28** | **16 initial 308 aliases followed**                   |

The raw per-request records are [render-probe-initial-results.json](render-probe-initial-results.json)
and [render-probe-builtin-redirects.json](render-probe-builtin-redirects.json). The latter is
authoritative for Built-in Agent final destinations; the former preserves its initial scoped 308
responses alongside the direct-context results.

## Findings requiring the complete defect audit

1. Google ADK `display-only` and `interactive` each returned HTML 200 but their `.mdx` endpoint
   returned 404. The HTML titles were `google-adk`, so this establishes a representation-status
   mismatch without claiming the rendered HTML is a valid guide. This confirms the request-level
   symptom for the existing source-resolution candidates.
2. `background-tasks` has the same HTML-200/MDX-404 mismatch in LangGraph Python, LangGraph
   TypeScript, Google ADK, and Strands. Built-in Agent redirects it to `/background-tasks`, where
   both forms return 404.
3. `browser-use` and `observational-memory` return 404 in both representations for every sampled
   final context. This is expected evidence for source-absent candidates, not a verdict that every
   unsupported feature requires a page.
4. The quarantined LangGraph Python and LangGraph TypeScript `headless` and `useInterrupt` routes
   each returned 200 for HTML and Markdown. The Built-in Agent aliases redirect to the matching
   root routes, which also returned 200 in both representations. The sample shows route parity;
   it does not establish runnable feature parity.
5. The sampled rendered responses contained iframe tags for the LangGraph Python and TypeScript
   display-only/interactive routes, Strands interactive HTML, and ADK `useInterrupt` HTML. No
   external iframe URL was requested, so this is markup evidence only and does not validate a
   hosted feature viewer.

The direct rendering behavior is consistent with the repository's explicit rule that scoped
`generative-ui/your-components/*` routes render directly rather than receiving a bare-route
redirect (`showcase/shell-docs/next.config.ts:855-859`). It does not replace content, fixture, or
runtime verification.

## Limits

This is a bounded HTTP render sample, not the full 220-cell inventory. It records status, final
redirect destination, content type, byte size, page title where present, and iframe-tag count. It
does not execute iframe content, inspect client-side interactions, or test a provider runtime.
