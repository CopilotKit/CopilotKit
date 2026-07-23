# QA: Pre-Built Popup — CrewAI (Crews)

## Prerequisites

- Demo deployed; agent backend healthy.

## Test Steps

- [ ] Navigate to `/demos/prebuilt-popup`.
- [ ] Verify the main content heading "Popup demo — look for the floating launcher" is visible.
- [ ] Verify `<CopilotPopup />` is open by default.
- [ ] Verify the floating launcher bubble is visible in the corner.
- [ ] Send "Say hi from the popup!" and verify an assistant reply arrives.
- [ ] Close the popup via the launcher; verify it collapses back to the floating bubble.
- [ ] Re-open; verify prior messages persist.

## Expected Results

- Popup opens by default.
- Floating launcher is always visible and toggles the popup.
