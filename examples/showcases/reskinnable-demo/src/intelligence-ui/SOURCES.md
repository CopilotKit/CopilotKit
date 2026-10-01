# Intelligence UI: sources

The `/intelligence` screens (`src/app/intelligence`) are the Intelligence web app's own UI, copied in.
They live outside every skin and are not linked from any skin.

## Copied from Intelligence

Repository `CopilotKit/Intelligence`, branch `david/analytics-governance-backend` at **e20922ca4**
(the build behind the local Intelligence web app).

| Here | Source |
| --- | --- |
| `ui/` | `libs/ui/src/` (`@cpki/ui`: primitives, feedback, overlays, forms, data display, typography, layout, styles, fonts). `charts/` left out; stories and tests left out. |
| `shell/intelligence-shell.css` | `apps/app-frontend/react-shell/src/styles.css` |
| `shell/intelligence-shell.tsx` | Markup of `WorkspaceHeader`, `ManagedServiceShellFrame`, `NavGroup`, `SidebarFooter` in `apps/app-frontend/react-shell/src/app.tsx` |
| `shell/workspace-page-header.tsx` | `apps/app-frontend/react-shell/src/workspace-page-header.tsx` |
| `public/intelligence-ui/mark.svg` | `apps/app-frontend/react-shell/public/logos/mark.svg` |
| `learning/*` | `apps/app-frontend/react-shell/src/learning/`: container-workspace, learning-page, learning-sidebar, insights-list, skills-list, candidates-list, runs-list, latest-analysis, learning-drawers, learning-dialogs, skill-delivery(-toggle), automatic-learning, learning-container-state, learning-routes, learning-refresh-context, use-learning-request, learning-icons, learning-api (types and schemas only), and their CSS modules |
| `overview/MetricTile.*`, `overview/project-overview.module.css` | `apps/app-frontend/react-shell/src/analytics/components/MetricTile.*`, `src/home/project-overview.module.css` |

Changes to the copied files are limited to: imports (`@cpki/ui/*` to `../ui/*`, `react-router` to
`shell/router.tsx`), the thread-import / SDK-connect / onboarding / schedule pieces left out, the
Learning sidebar taking the adapter as a prop, "Source Thread" / "Open Thread" reading "trajectory",
and a lint header on files that trip the React Compiler rules this app enables and Intelligence does not.
`ledgerline-learning-api.ts` implements the copied `LearningApi` interface over `/api/learning/v1`.

## Copied from CopilotKitCommonAgentWorkspace

The trajectory view (`trajectory-view/`) is Atai's prototype at **origin/main 9c9dc16b**; see
`trajectory-view/SOURCE.md`.

## New screens

Trajectories list, Eval candidates and Fine-tune (`screens/`) do not exist in Intelligence yet. They are
composed only from the copied pieces above. Provider logos in `public/intelligence-ui/logos/` are the
official marks from each company's own site (LangChain brand assets, braintrust.dev, thinkingmachines.ai,
AWS Architecture Icons).
