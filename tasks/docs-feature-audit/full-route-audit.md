# Complete selected-guide local route audit

## Evidence contract

This report extends the bounded render sample. It derives every selected React catalog route from
`inventory.json`, preserving each route's inventory cell IDs, manifest state, source-resolution
state, and redirect chain. It also includes every root product guide in the agreed Threads,
Intelligence, and Channels families. The source snapshot is
`fa6041fc7b08fc5866099769038e43c44c1ce8df`; the input inventory SHA-256 is
`d1e28ad0b6b66fab1d6b56fc2e8d072053fb75cf3865216a497a0f7556b42e79`.

The full machine-readable evidence is [full-route-audit.json](full-route-audit.json). Each record
contains the initial and final paths, full local redirect chain, final HTTP status, content type,
byte size, title, iframe-tag count, narrowly-scoped rendered-error markers, and the matched
inventory metadata. It is route evidence only: it does not run an iframe, a provider, or a
Showcase runtime.

## Local method

The existing disposable worktree `/private/tmp/copilotkit-shell-docs-render-audit` supplied the
already-built production output. No rebuild, product-doc edit, generated-source change, provider
credential, or external iframe request was made. The local server started and stopped within the
same probe command:

```text
cd showcase/shell-docs && ./node_modules/.bin/next start -p 3104
python3 /private/tmp/copilotkit-shell-docs-render-audit/probe_full_route_audit.py
```

This follows the documented local build lifecycle, which generates registry, demo/setup, and
search data before a shell-docs build (`showcase/shell-docs/README.md:27-42`).

## Exact coverage and final status

| Family                      | Initial guide routes | HTML + MDX representations | Both representations 200 | Both 404 | HTML 200 / MDX 404 |
| --------------------------- | -------------------: | -------------------------: | -----------------------: | -------: | -----------------: |
| Selected five-agent catalog |                  155 |                        310 |                      138 |       11 |                  6 |
| Threads                     |                    6 |                         12 |                        6 |        0 |                  0 |
| Intelligence                |                    8 |                         16 |                        8 |        0 |                  0 |
| Channels                    |                   12 |                         24 |                       12 |        0 |                  0 |
| **Total**                   |              **181** |                    **362** |                  **164** |   **11** |              **6** |

Final representations were 334 HTTP 200 and 28 HTTP 404; no 5xx response was recorded. The
source inventory accounts for 138 resolved and 17 unresolved catalog route bindings. All 26
product-guide routes resolved in both HTML and MDX.

Thirty-one Built-in Agent scoped catalog routes returned 308 aliases to root routes in each
representation (62 redirected representations). Two aliases then made an additional documented
301 hop: `agentic-chat-ui` to `/prebuilt-components` and `headless` to
`/custom-look-and-feel/headless-ui`. All 12 Channels initial routes similarly returned 308 to
their `/slack` route; every final HTML and MDX route was 200. These redirects are preserved in the
JSON rather than counted as a failure.

## Availability review

The 11 both-404 route pairs all map to inventory `unshipped` status: `browser-use` and
`observational-memory` in every selected context, plus Built-in Agent `background-tasks` after its
root alias. They are recorded as intentional/unshipped availability evidence, not defects.

The six HTML-only route pairs are the four unshipped `background-tasks` contexts (LangGraph
Python, LangGraph TypeScript, ADK, and Strands), plus the two already-known Google ADK candidates:
`generative-ui/your-components/display-only` (`gen-ui-tool-based`) and `interactive`
(`hitl-in-chat`). Both ADK candidates are manifest `wired` but source-unresolved in the inventory;
their local HTML response is 200 with title `google-adk`, while the matching MDX endpoint is 404.
This is confirmed response asymmetry and remains a content/guide defect candidate until the
complete audit assigns its disposition.

## Rendered error signals

Two HTML 200 pages contained an actual user-visible `Missing snippet` alert. This is stronger
than a status-only result and should stay in the defect review:

1. Built-in Agent `a2ui-fixed-schema` is manifest `wired`; its scoped route 308s to the root A2UI
   page, where the alert reports that region `backend-schema-json-load` is absent for the Built-in
   Agent binding. Both final representations nevertheless return 200.
2. Strands `reasoning-messages` maps to `reasoning-default` and `reasoning-custom`, both
   inventory `unshipped`; the HTML page reports missing demos for those bindings. Its 200 status is
   therefore insufficient to call it content-available. Whether the alert itself is acceptable for
   an intentionally unshipped guide needs the agreed product policy.

Iframe tags appeared in 108 sampled representations. No external frame was loaded, so these
records establish only that the local route emitted iframe markup; they do not validate hosted
feature viewers.

## Limits

The audit proves delivery and representation behavior for the whole current selected route set. It
does not prove that 200 pages have correct prose, copy prompts, snippets, or supported runtime
outcomes. Keep the inventory's support/quarantine declarations and local D6 evidence separate
from this HTTP result.
