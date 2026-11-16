# A2UI Error Recovery

## What This Demo Shows

A model sometimes generates an A2UI surface that does not match the catalog. This demo shows what the user sees then. The agent validates each surface and retries an invalid one with the errors. When every attempt fails, the chat shows a clear failure state instead of a broken surface.

## How to Interact

Click one of the two suggestions:

1. **Recover a bad render**: the first render is invalid, and the retry heals it into a dashboard.
2. **Show an unrecoverable failure**: every render is invalid, so the chat shows "Couldn't generate the UI".

The invalid renders come from aimock fixtures. A real model does not produce them reliably.

## Technical Details

- The page uses the sales dashboard catalog and the sales context of declarative-gen-ui, from `../_shared/a2ui-sales-dashboard/`.
- The agent runs the validate and retry loop. The recovery states (building, retrying, failed) come from `@copilotkit/react-core/v2`.
- The pill messages are the keys of the aimock fixtures. Most agents send the inner render call without the X-AIMock-Context header, so each integration needs its own messages.
- Each integration sets its messages as `prompts` in `src/integrations/<slug>/demos/a2ui-recovery.ts`. Without that file, the page uses `DEFAULT_A2UI_RECOVERY_CONFIG` from `config.ts`.
- The same settings pick the catalog protocol and the format selector, as in declarative-gen-ui.
