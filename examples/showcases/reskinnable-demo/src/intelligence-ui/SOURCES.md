# Intelligence UI: sources

The `/intelligence` screens (`src/app/intelligence`) are the Intelligence web app's own UI, copied in.
They live outside every skin and are not linked from any skin.

## Copied from Intelligence

Repository `CopilotKit/Intelligence`, `main` at **b71006350**: the workspace design system
(Tyler's 916512c34 "apply the workspace design system across Intelligence" and its follow-ups).
`libs/ui/WORKSPACE-DESIGN.md` is the contract these screens follow.

| Here                                                            | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/`                                                           | `libs/ui/src/` (`@cpki/ui`: primitives, feedback, overlays, forms, data display, datetime, typography, layout, styles incl. `workspace-theme.css` and `workspace-components.css`, fonts, `motion-preference.ts`). `charts/` and `testing/` left out; stories and tests left out.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `shell/intelligence-shell.css`                                  | `apps/app-frontend/react-shell/src/styles.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `shell/workspace-shell.css`                                     | `apps/app-frontend/react-shell/src/workspace-shell.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `shell/workspace-*.ts(x)`, `shell/workspace-*.module.css`       | the same files in `apps/app-frontend/react-shell/src/`: page header, collection toolbar and page, entrance motion, loading, grid scroll edges, rail tooltip, theme and theme menu, shell frame                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `shell/intelligence-shell.tsx`                                  | Markup of `ManagedServiceShellFrame`, `WorkspaceRail`, `WorkspaceHeader`, `NavGroup`, `WorkspaceSidebar`, `SessionAccountButton` in `app.tsx` and `WorkspaceProjectPicker` in `workspace-project-picker.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `public/intelligence-ui/logo.svg`, `logo-dark.svg`, `mark.svg`  | `apps/app-frontend/react-shell/public/logos/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `learning/*`                                                    | `apps/app-frontend/react-shell/src/learning/`: learning-page, learning-directory, learning-space-list, learning-space-tabs, learning-space-settings, container-workspace, container-connect-card, insights-list, finding-list, supporting-insights, learning-evidence-browser, skills-list, skill-entry, skill-delivery(-toggle), candidates-list, runs-list, latest-analysis, learning-drawers, learning-dialogs, learning-notice, local-evaluation-notice, learning-model-missing, automatic-learning, learning-container-state, learning-routes, learning-refresh-context, use-learning-request, learning-icons, learning-api (types and schemas only), and their CSS modules |
| `overview/MetricTile.*`, `overview/project-overview.module.css` | `src/analytics/components/MetricTile.*`, `src/home/project-overview.module.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `overview/overview-activity.tsx`                                | The presentational half of `src/home/project-overview-activity.tsx` (section header, metric row, the Learning Space and recent tables, activity grid)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `screens/trajectory-list.module.css`                            | `libs/trajectories/src/components/trajectory-list.module.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Changes to the copied files are limited to:

- imports (`@cpki/ui/*` to `../ui/*`, `react-router` to `shell/router.tsx`, `../workspace-*` to `../shell/workspace-*`);
- the Learning page's hosted `LearningRoute` wrapper left out (the screen passes the adapter and schedule itself);
- "Source Thread" / "Open Thread" reading "trajectory";
- server-render guards where Next renders a client component before `window` exists (`workspace-shell-frame`,
  `workspace-theme`, and the theme menu's icon drawn from the saved theme only after mount);
- `clearWorkspaceTheme` (drops the root attributes when /intelligence unmounts) and
  `workspace-theme-bootstrap.ts` (the pre-paint script, run from the root layout's `beforeInteractive` slot,
  only on /intelligence routes);
- a lint header on files that trip the React Compiler rules this app enables and Intelligence does not.

Stand-ins for pieces left out (same props, no backend): `learning/learning-schedule.tsx` (a fixed daily 2:00 AM
schedule, same markup), `learning/thread-import-entry.tsx`, `learning/learning-thread-binding(-api)`,
`learning/learning-membership-api.ts`, `learning/learning-onboarding-empty-state.tsx`, and `api-client.ts`
(the client type and `ApiClientError`). `ledgerline-learning-api.ts` implements the copied `LearningApi`
interface over `/api/learning/v1`.

## Copied from CopilotKitCommonAgentWorkspace

The trajectory view (`trajectory-view/`) is Atai's prototype at **origin/main 9c9dc16b**; see
`trajectory-view/SOURCE.md`. `screens/trajectory-frame.tsx` embeds it and passes the workspace theme through
the view's own `data-theme` switch.

## New screens

Overview (on main's project-overview pieces), User Trajectories (laid out like `libs/trajectories`'
`TrajectoryListView`, with the demo's outcome and surface columns), Eval candidates, Fine-tune and Data export
(`screens/`) are composed from the copied pieces and workspace tokens only. Provider logos in
`public/intelligence-ui/logos/` are the official marks from each company's own site (LangChain brand assets,
braintrust.dev, thinkingmachines.ai, AWS Architecture Icons, Simple Icons); they sit on a light plate so they
read in either theme.

## Generative UI, Product Analytics and Product Insights

Generative UI in a trajectory is the Ledgerline skin's own React component (`genui/registry.tsx`: the close
status card, the review card, the report card and table, the learned-skill card), rendered read-only by
`/intelligence/genui/[trajectoryId]/[stepId]` in an iframe the trajectory view keeps alive across re-renders.
Which component a step drew is read from the recorded call (`genui/derive.ts`); a review card's receipts and a
seeded report card are read back on the server (`genui/server.ts`). ChatGPT's cards are the built MCP App
(`src/skins/ledgerline/mcp-app/dist/ledgerline-app.html`) hosted through an `AppBridge`. Product Analytics and
Product Insights (`screens/analytics-screen.tsx`, `screens/insights-screen.tsx`) are new: a seeded week in
`ledgerline/analytics-data.ts`, with the month-end close read live from `/api/ledgerline/v1/reconciliation/status`.
