# Northstar Logistics Autopilot prototype

This is a local Next.js and SQLite logistics app backed by CopilotKit v2, a live `BuiltInAgent`, and CopilotKit Intelligence. Staff can manage orders and users manually. The assistant can read the current page, navigate, and propose form or cancellation actions through the browser. Writes require the app's confirmation and are checked again before dispatch.

## Run locally

Use Node 24 and the repository's pinned pnpm. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm nx run @copilotkit/autopilot-logistics:seed
pnpm nx run @copilotkit/autopilot-logistics:build
pnpm nx run @copilotkit/autopilot-logistics:start
```

Set `CPK_INTELLIGENCE_API_KEY` and `OPENAI_API_KEY` in `examples/v2/autopilot-logistics/.env.local` before building. The key names and optional `AUTOPILOT_MODEL` and `NORTHSTAR_DB_PATH` are documented in `.env.example`. The default model is `gpt-5.2`. Keep `.env.local` out of git. The app opens at <http://127.0.0.1:3000>.

The sign-in page lists fictional local accounts. Choose Avery Morgan (Northstar admin) for the full walkthrough. Jordan Lee is an operator; Sam Rivera is a viewer. Morgan Chen and Casey Park belong to a separate organization. No password or external identity provider is involved.

On the dashboard, ask the assistant to find an order, open its detail page, and explain its status. Ask it to create a booked shipment with an origin, destination, date, service level, assignee, and notes; review the app confirmation before accepting. Try a separate destination or status edit, then cancel a booked order. The `Users` page lets the admin manage accounts. The assistant panel's Agent and Autopilot controls let you choose Logistics or Operations and narrow Autopilot to Off, Logistics only, or All agents. Off still permits ordinary chat tools.

SQLite persists under `examples/v2/autopilot-logistics/data/northstar.sqlite` by default. The seed target is safe to rerun without deleting existing rows. To intentionally restore the fictional baseline, run `pnpm nx run @copilotkit/autopilot-logistics:reset`; this deletes local prototype data.

## Verification and source

Run `pnpm nx run @copilotkit/autopilot-logistics:test:browser` against a running production app. The one-worker Chromium suite checks live agent calls, browser/SQL outcomes, manual roles, restarts, approval rejection, and the local Inspector. Run `pnpm nx run @copilotkit/core:test` for the reusable execution and approval gate tests. The packed-package portability check is `pnpm nx run @copilotkit/autopilot-logistics:portability`; it creates a temporary isolated consumer and runs a live production sequence from packed CopilotKit artifacts. It uses substantial temporary disk space. The script's report records artifact checksums and resolved package paths.

For a local privacy audit, set `AUTOPILOT_MODEL_INPUT_AUDIT_FILE` to an ignored output path and `AUTOPILOT_MODEL_INPUT_AUDIT_CANARIES` to comma-separated test canaries in both the app-start and browser-test environments. The agent factory records only the thread ID, message count, and Boolean canary matches for the actual `messages`, `systemPrompts`, and `tools` passed to the TanStack `chat` adapter. The read test checks those rows alongside the stored thread and Inspector. This opt-in audit does not record prompts, keys, or raw model input.

App code is under `src/`, browser tests under `tests/`, and seed/portability scripts under `scripts/`. Reusable browser navigation, form driving, budgets, and approval checks live in `packages/core`; runtime activation lives in `packages/runtime`; provider/tool integration lives in `packages/react-core`. The current acceptance scoreboard, trial evidence, known limits, and friction report are in `tasks/autopilot/HILLCLIMB.md` at the repository root.

## Generic browser adapter contract

The agent has no order-specific tool. `autopilot_readPage` and `autopilot_findControls` return short-lived references to visible controls. The first tool bounds its snapshot; the second can search later controls by accessible name or containing form name when that snapshot is truncated. `autopilot_navigate` accepts only a discovered link reference, and `autopilot_activateControl` accepts only a discovered button reference. The package-level `BrowserPageMap`, `BrowserNavigator`, and `BrowserControlActivator` resolve and recheck these references; no tool maps an order label or route to business logic. The app's ordinary `CancelOrder` handler supplies review text to the CopilotKit approval controller, checks the local approval binding after the human decision, then calls the same role-, tenant-, version-, and operation-key-checked server route used for manual cancellation. The agent cannot accept the approval card. The nonblocking card is the default `CopilotChat` `approval` slot; a consumer can replace that slot or use `CopilotApprovalController` and `useCopilotApproval` from `@copilotkit/react-core/v2/headless` for a custom surface. Only a trusted user event can approve. Stop, user edits, navigation, sign-out, and abort cancel a pending request. The app supplies the effect summary and still owns authorization, validation, and completion receipts.

Reusable frontend tools can provide `filterResult` and `filterError` callbacks. Core applies them before persisting or returning handler output to an agent, including the WebMCP path; a failing result filter returns a generic error. If a filter closes over changing policy, pass the changing values through the frontend tool hook's dependency argument so it re-registers. These callbacks cannot erase tool arguments already streamed before execution, so private data must also be excluded from page discovery and tool schemas. The default page map filters `data-copilot-private` regions, hidden elements, and derived labels that point into those regions.

For a custom chat, create one `CopilotApprovalController`, pass it to the component that proposes an effect, and read it from the UI with `useCopilotApproval(controller)`. The hook returns the pending review and `respond(event, approved)`; pass the actual click event from the human's Approve or Decline button. `controller.request({ description, agentId, threadId }, signal)` resolves to `"approved"`, `"declined"`, or `"cancelled"`, so Stop is distinct from a human decline. Headless consumers render their own buttons and review layout; the decision never authorizes a server write by itself, so the application must recheck and dispatch through its normal handler. Use `useCopilotApprovalWork(controller)` to keep a custom Stop control available from proposal through accepted work until the app settles the effect. The controller also has `cancel()` for takeover or teardown.

After approval, the application records only the operation and signed-in identity metadata in tab-scoped storage until its normal handler reports a definitive result. On reload, CopilotKit restores the saved thread and the reusable `statusNotice`/`notice` chat slot shows an unconfirmed-outcome card if that result was lost. The card does not authorize a retry; the user checks the current record and can dismiss it. Normal completed or denied results clear the marker. A headless consumer can render the same application status beside its custom approval controls.

If a reviewed multi-field fill stops before submit, CopilotKit shows a separate partial-outcome notice in chat. Browser fields may have changed locally, but the form was not submitted and no server write is confirmed. The user should review the form manually. Unsupported field types are refused before the review card or any input event.

This prototype needs an explicit app adapter with substantial code and annotations, as counted in the scoreboard. `data-copilot-page` marks the readable app shell so navigation outside `<main>` can be discovered; `data-copilot-private` excludes account controls and chat. `data-copilot-action="cancel"` is the app's declared action identity, not an agent command. The record/draft ID, version, and handler-version attributes (`data-autopilot-*`, retained for compatibility with the existing form driver) bind a reviewed operation to the current target and implementation. Custom-select option attributes expose values to the generic form driver. The app emits a form completion event; the cancel handler directly reports its server receipt to the shared approval gate. These annotations and receipts are required because a click or submit alone cannot prove the business effect, and approval must fail closed when the target or handler changes. Route allowlisting and unsaved-form confirmation remain app-owned policy in `AssistantShell`; the agent sees no route aliases.
