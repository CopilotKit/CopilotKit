# Angular Showcase accessibility evaluation

This document is the required human evidence record for the Angular Showcase
scope. Automated Axe, keyboard, focus, responsive, reduced-motion, and security
checks run in `test / showcase frontend matrix`; they do not replace this
evaluation. Do not claim WCAG 2.2 AA conformance while any applicable row is
untested or failing.

## Evidence identity

Complete these fields against the same immutable preview deployed from the pull
request head.

| Field                                            | Value   |
| ------------------------------------------------ | ------- |
| Pull request                                     | Pending |
| Exact commit SHA                                 | Pending |
| Preview URL and deployment ID                    | Pending |
| Browser evidence workflow and artifact           | Pending |
| Evaluator                                        | Pending |
| Evaluation date                                  | Pending |
| Desktop OS, browser, version, and zoom           | Pending |
| Mobile OS, browser, version, and viewport/device | Pending |
| Screen reader and version                        | Pending |

Status at authoring: **pending human execution**.

## Declared scope

Evaluate every state below. Re-run a state after any material markup,
interaction, layout, color, or announcement change.

| State                                     | Desktop | Mobile  | Screen reader |
| ----------------------------------------- | ------- | ------- | ------------- |
| Agentic chat ready                        | Pending | Pending | Pending       |
| Popup open                                | Pending | Pending | Pending       |
| Popup closed with launcher focus restored | Pending | Pending | Pending       |
| Sidebar open                              | Pending | Pending | Pending       |

The automated projects are Chromium, Firefox, and WebKit desktop engines plus
Chromium Pixel 7 and WebKit iPhone 13 emulation. Emulation is not evidence of a
branded browser or physical device. Record the actual human-test combination in
the evidence identity table.

## Human checklist

For each scoped state, record **Pass**, **Fail**, or **Not applicable** and add a
brief note or linked issue for every failure. “Pass” means the behavior was
observed, not inferred from source or automated output.

| Requirement                                                                | Chat    | Popup open | Popup close | Sidebar           | Evidence or issue |
| -------------------------------------------------------------------------- | ------- | ---------- | ----------- | ----------------- | ----------------- |
| All functionality is operable with keyboard only                           | Pending | Pending    | Pending     | Pending           | Pending           |
| Focus order is logical and visible                                         | Pending | Pending    | Pending     | Pending           | Pending           |
| Modal focus stays contained for keyboard and pointer interaction           | N/A     | Pending    | N/A         | Pending on mobile | Pending           |
| Initial focus is appropriate and launcher focus is restored                | N/A     | Pending    | Pending     | Pending on mobile | Pending           |
| Escape and documented close controls work without side effects             | N/A     | Pending    | Pending     | Pending           | Pending           |
| Background content is inert while a modal surface is open                  | N/A     | Pending    | N/A         | Pending on mobile | Pending           |
| Names, roles, values, and expanded/modal states are announced accurately   | Pending | Pending    | Pending     | Pending           | Pending           |
| Status, loading, error, interrupt, and generated-UI changes are announced  | Pending | Pending    | N/A         | Pending           | Pending           |
| Text and controls remain usable at 200% zoom                               | Pending | Pending    | Pending     | Pending           | Pending           |
| Content reflows without two-dimensional scrolling at 320 CSS px            | Pending | Pending    | Pending     | Pending           | Pending           |
| Text, UI-component, focus-indicator, and state contrast meet AA thresholds | Pending | Pending    | Pending     | Pending           | Pending           |
| Pointer targets and drag-independent alternatives satisfy WCAG 2.2         | Pending | Pending    | Pending     | Pending           | Pending           |
| Reduced-motion mode removes non-essential animation without hiding state   | Pending | Pending    | Pending     | Pending           | Pending           |
| Screen-reader browse and forms modes preserve labels, landmarks, and order | Pending | Pending    | Pending     | Pending           | Pending           |
| Errors are identified in text and recovery does not lose context           | Pending | Pending    | N/A         | Pending           | Pending           |

## Screen-reader script

1. Start from the feature-page heading and navigate by landmarks and headings.
2. Reach the chat composer, toolbar, and send control without using a pointer;
   confirm every icon-only control has an understandable name.
3. Enter and submit a message, then observe streaming, completion, tool,
   interrupt, generated-UI, and error announcements supported by the selected
   deterministic fixture.
4. Open the popup, traverse all focusable controls in both directions, verify
   that background controls cannot be reached, close it with Escape, and confirm
   the launcher is announced and focused.
5. Open the desktop docked sidebar and verify complementary-landmark behavior;
   repeat at the mobile breakpoint and verify modal behavior and containment.
6. Repeat the popup and mobile sidebar checks with reduced motion enabled.

## Completion rule

Release-readiness evidence is complete only when every applicable row is Pass,
all failures have been fixed and re-tested, the exact preview identity is
recorded, and a human screen-reader pass is attached to the implementation pull
request. Keep the pull request in draft while this record is pending.
