---
"@copilotkit/web-inspector": patch
---

feat(web-inspector): add an `oss.inspector.opened` telemetry event and split announcement-banner impressions by surface

Panel opens are now measured directly instead of inferred from in-panel activity, and
`banner_viewed` carries a `surface` (`collapsed_preview` vs `expanded_card`) stamped at
fire time so bubble reach and in-panel attention are distinguishable. Dismissal is also
promoted to a first-class `banner_dismissed` event, emitted alongside the existing
`banner_clicked { cta: "dismiss" }`. All of it respects the runtime's `telemetryDisabled`
and the local opt-out.
