# Northstar Logistics Autopilot prototype

This is a local Next.js and SQLite logistics app backed by CopilotKit v2, a live `BuiltInAgent`, and CopilotKit Intelligence. Staff can manage orders and users manually. The assistant can read the current page, navigate, and propose form or cancellation actions through the browser. Writes require CopilotKit's human review and are checked again before dispatch.

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

On the dashboard, use the docked CopilotSidebar to ask the assistant to find an order, open its detail page, and explain its status. Ask it to create a booked shipment with an origin, destination, date, service level, assignee, and notes; review the app confirmation before accepting. Try a separate destination or status edit, then cancel a booked order. The `Users` page lets the admin manage accounts. The sidebar header's Agent and Autopilot controls let you choose Logistics or Operations and narrow Autopilot to Off, Logistics only, or All agents. Off still permits ordinary chat tools.

SQLite persists under `examples/v2/autopilot-logistics/data/northstar.sqlite` by default. The seed target is safe to rerun without deleting existing rows. To intentionally restore the fictional baseline, run `pnpm nx run @copilotkit/autopilot-logistics:reset`; this deletes local prototype data.

## Verification and source

Run `pnpm nx run @copilotkit/autopilot-logistics:test:browser` against a running production app. The one-worker Chromium suite checks live agent calls, browser/SQL outcomes, manual roles, restarts, approval rejection, and the local Inspector. Run `pnpm nx run @copilotkit/core:test` for the reusable browser execution and approval tests. The packed-package portability check is `pnpm nx run @copilotkit/autopilot-logistics:portability`; it creates a temporary isolated consumer and runs a live production sequence from packed CopilotKit artifacts. It uses substantial temporary disk space. The script's report records artifact checksums and resolved package paths.

For a local privacy audit, set `AUTOPILOT_MODEL_INPUT_AUDIT_FILE` to an ignored output path and `AUTOPILOT_MODEL_INPUT_AUDIT_CANARIES` to comma-separated test canaries in both the app-start and browser-test environments. The agent factory records only the thread ID, message count, and Boolean canary matches for the actual `messages`, `systemPrompts`, and `tools` passed to the TanStack `chat` adapter. The read test checks those rows alongside the stored thread and Inspector. This opt-in audit does not record prompts, keys, or raw model input.

App code is under `src/`, browser tests under `tests/`, and seed/portability scripts under `scripts/`. Reusable browser navigation, form driving, budgets, and approval checks live in `packages/core`; runtime activation lives in `packages/runtime`; provider/tool integration lives in `packages/react-core`. The current acceptance scoreboard, trial evidence, known limits, and friction report are in `tasks/autopilot/HILLCLIMB.md` at the repository root.

## Integration boundary

The demo registers **no frontend tools**. `CopilotKitProvider` installs the generic browser catalog when its `autopilot` config includes an adapter:

```tsx
const adapter = createAutopilotAdapter(user, router);
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  autopilot={{ adapter, enabled: true, agents: ["logistics"] }}
>
  <CopilotSidebar showAutopilotActivity />
</CopilotKitProvider>;
```

`src/lib/autopilot.ts` supplies only session identity, a fresh write-permission check, router navigation, allowed routes, and the unsaved-form guard. Server routes remain responsible for roles, tenants, validation, record versions, and idempotency. The adapter is not server authorization.

The provider owns discovery, budgets, short-lived control references, review cards, clarification, takeover, and uncertain-outcome recovery. `autopilot_readPage`, `autopilot_findControls`, `autopilot_navigate`, `autopilot_goBack`, `autopilot_submitReadOnlyForm`, `autopilot_submitForm`, `autopilot_activateControl`, and `autopilot_askUser` are package tools. There are no order-specific tools or route aliases. Turning Autopilot off removes browser tools from the agent's available catalog; ordinary chat still works.

Write handlers use `performBrowserAction` from `@copilotkit/react-core/v2` to report the actual business result:

```tsx
await performBrowserAction(form, event.nativeEvent, async () => {
  const saved = await saveThroughExistingApi();
  return { status: "completed", recordId: saved.id, version: saved.version };
});
```

Real manual events still use the ordinary handler. Synthetic dispatch requires a one-use package approval binding. Handlers return `failed` for a definitive refusal and `uncertain` when they cannot confirm the result. Button handlers can supply their existing manual confirmation as the fourth argument. App code does not assemble approval controllers, browser drivers, or operation state.

Both form submission and button activation share one reviewed-effect lifecycle in Core. A browser record lock spans human review through the application receipt. The package checks agent/thread/request/session, scope, pathname, target identity/version/handler, and current form membership and submission state before dispatch. Partial fills stop without submitting. A missing or uncertain receipt leaves a tab-scoped marker containing no field values; reload restores a notice and does not automatically retry.

## Markup and customization

- `data-copilot-page` bounds readable app content; `data-copilot-private` excludes sensitive regions. Package chat components mark themselves private.
- `data-copilot-readonly-form` plus `method="get"` declares an app-owned read-only endpoint. Routes must also pass the adapter allowlist.
- `data-autopilot-record-id` (or draft ID), record version, and handler version bind reviewed effects to live controls. These retained prototype attributes are not business commands.
- `data-copilot-action` declares a button's action identity, and `data-copilot-confirm` supplies its review description. Custom-select annotations expose choices to the generic driver.

The normal `approval`, `clarification`, `notice`, and activity chat slots remain replaceable. Headless consumers can pass `approvalController` and `clarificationController` in the provider's `autopilot` config and subscribe with `useCopilotApproval`, `useCopilotApprovalWork`, and `useCopilotClarification`. Only a trusted human event can approve or answer; Stop and lifecycle changes cancel pending work. Consumers replacing the entire chat surface must mark their interaction region `data-copilot-private`.

Frontend tool result/error filters run before results are persisted or sent to the agent, including WebMCP execution. They cannot redact arguments already streamed into a tool call. Keep private content out of discovery and schemas. Page content is treated as untrusted task data. This remains an explicit-adapter prototype, not arbitrary unattended browser automation.
