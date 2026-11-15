# A2UI accessibility spike (PNI-819)

Private, unpublished test support for React, Vue and Angular. This folder belongs under `packages/` so Nx can track it as a project and select the three consumers when it changes. It has no build target, runtime entry point or runtime consumers. Its only dependencies are exact-pinned **devDependencies**: `axe-core@4.11.1` (the Angular version) and `@ui-sdk/core@0.1.0-beta.5` (the proposal's version and the npm beta tag inspected during the spike; latest was beta.3). The UI SDK tarball has no dependencies or install scripts. No renderer dependency or public export changes.

`fixtures.json` is shared JSON, ingested through each framework's existing real surface manager, dispatcher and standard catalog test renderer. Open overlays are activated before inspection; body-level scanning includes teleported/portaled content. The chat suites use the actual popup/sidebar chrome with framework providers (Angular supplies a minimal chat body). React/Vue desktop sidebars are complementary regions, so the dialog pattern applies only to their popups. Angular tests its overlay sidebar.

## Run

From the repository root:

```sh
pnpm nx run-many -t test:a11y --projects=@copilotkit/react-core,@copilotkit/vue,@copilotkit/angular --parallel=1
```

The same test files run in each package's ordinary `test` target and hence the existing `test_unit.yml` build/test selection. Project dependencies select the consumers. The ordinary `test`, focused `test:a11y` and `check-types:a11y` targets include each consumer's default project inputs and dependency production inputs, covering Vue `.vue` components and upstream renderer code as well as TypeScript. Explicit inputs also include this helper, its JSON fixtures, baselines and test configuration, so changes invalidate cached results. No workflow is added.

To save per-fixture tool results and scan durations, set `A11Y_REPORT_DIR` to an absolute directory outside the checkout and use the shared report target:

```sh
A11Y_REPORT_DIR=/absolute/path/to/a11y-reports pnpm nx run @copilotkit/a11y-test-kit:report
```

Each returned and saved report includes the complete `classification: { known: string[], new: string[] }` signature arrays alongside the tool findings, warning counts and duration. Every new signature is also printed to stderr without truncation, allowing CI logs to show all findings even without saved reports. The report target is uncached and passes `--skipNxCache` to its nested test run, so both levels execute rather than replaying results. Use it when measuring, collecting reports or updating baselines; ordinary test targets remain cached.

To review a proposed baseline update locally:

```sh
A11Y_UPDATE_BASELINE=1 pnpm nx run @copilotkit/a11y-test-kit:report
```

Review the diff and rerun without the flag. Updates are rejected in CI. All accessibility findings are non-blocking warnings, including new findings, additional occurrences and missing fixture baselines. Reviewed findings are classified as known; the baseline is a report reference and does not gate tests. Warnings go directly to stderr so React and Angular silent-console settings cannot hide them in CI. Known checker false positives remain visible. Blocking mode is not implemented; it can be considered after the findings are resolved.

## Helper API

- `expectNoAxeViolations(root, options)` scans the probe's exact WCAG tag set: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. It returns findings and emits warnings without failing; options allow rule overrides and selector exclusions. Contrast is disabled in jsdom, which has no layout. The WCAG tag filter excludes best-practice dialog naming. It includes nested-interactive, but that rule does not match the EntityCard role-link structure; a clean scan does not cover every nesting concern.
- `observeClicks()` is installed before rendering and restored before scanning. `checkDOM(root, clicks, ignoreClicks)` checks click affordances, interactive names, ID references, focusable content under `aria-hidden`, and error-message references. Native elements provide implicit roles. Accessible text is computed by axe, including labels and labelled-by references. Host containers can be explicitly excluded from click checks because renderers delegate events there.
- `expectPattern(root, "tabs" | "dialog")` wraps `@ui-sdk/core/testing`. Only the pinned checker's exact report header for the requested pattern, with a positive count and that many nonempty finding bullets, is accepted as a finding report. Recognized findings are returned and emitted as non-blocking warnings; malformed reports and unexpected checker crashes propagate the original error as test-harness failures. The wrapper normalizes generated IDs without changing renderer DOM. Positive controls exercise a working widget and deliberately broken variants.
- `audit(...)` silently collects all findings, classifies exact node/rule/detail signatures against the checked-in per-framework baseline as a multiset, and emits one warning summary per affected fixture. It never fails for accessibility findings or a missing baseline. Low-level expectation APIs are warning-only too; there is no enforcement switch. Pattern checking may press keys, change tabs and close/reopen overlays, so run it last and clean up the fixture afterwards.

## Interpretation limits

DOM APIs do not enumerate existing listeners. Click observation must begin before rendering; React delegation also needs inline `onclick`/pointer affordances. Stop-propagation handlers and mouse-only dismissal backdrops can look actionable. These are recorded false positives, not proof that a component is keyboard-inoperable. An arbitrary delegated click handler without a DOM affordance can be missed.

The pattern checker supplies synthetic keyboard behavior, not real browser tab order. Its events omit legacy `keyCode`, which Angular CDK uses for tab navigation. CDK focus guards are deliberately focusable and `aria-hidden`; the DOM checker reports them, and the pattern checker's simulated tab order can leave focus on them. These findings require browser verification and are not evidence of a broken CDK trap. Its Angular reopening-focus finding remains unclassified and needs browser verification. React/Vue named A2UI Modal and the helper's positive controls distinguish these checker limits from real failures.

The EntityCard fixture is deliberately included even when all checks return no findings: that is a blind spot, not an accessibility pass. The WCAG scan includes nested-interactive, but axe 4.11.1 only applies it to roles with childrenPresentational semantics; link is not one of those roles. A role-link containing an action button is also outside the additional DOM invariants.

No contrast, focus visibility, browser/assistive-technology behavior, SSR/hydration, streaming updates or locale behavior is established here. Web Inspector tabs were not added: they live in shadow DOM, while this beta checker reads document-level activeElement and cannot follow shadow focus without additional integration. Browser and shadow-DOM work remains a separate slice.
