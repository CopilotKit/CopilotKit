---
"@copilotkit/react-core": minor
---

feat(react-core): A2UI error-recovery status renderer (OSS-162)

Add `createA2UIRecoveryRenderer` and auto-register it as a built-in activity renderer in
`CopilotKitProvider` (active when runtime A2UI is enabled), alongside the existing A2UI
surface/skeleton/tool-call renderers. It renders the `a2ui_recovery` data contract emitted by
the A2UI middleware: a delayed, non-disruptive "Retrying UI generation…" hint during
regeneration, and a clean hard-failure panel (with expandable developer detail) once the
attempt cap is reached. Timing and debug exposure are configurable via the provider's
`a2ui.recovery` option (`showAfterMs`, `showAfterAttempts`, `debugExposure`).
