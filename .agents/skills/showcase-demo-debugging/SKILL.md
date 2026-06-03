---
name: showcase-demo-debugging
description: Build, debug, and regression-test CopilotKit showcase demos. Use when working under showcase/, creating new showcase demos/items/cells/pills, implementing showcase features, investigating showcase demo bugs, D5/e2e-deep failures, aimock fixture gaps, direct-LLM versus aimock behavior, recording fixtures, testing every demo pill/cell, verifying repeated and interleaved suggestion-pill fixture stability, enforcing langgraph-python 1:1 parity, or migrating a demo to the v2 CopilotKit showcase flow.
metadata:
  internal: true
---

# Showcase Demo Work

## Start Here

Before changing code or fixtures, read the current local guides:

- `showcase/README.md`
- `showcase/RUNBOOK.md`
- `showcase/DEBUGGING.md`
- `showcase/INTEGRATION-CHECKLIST.md` when adding or changing a demo

Use `showcase/bin/showcase` for showcase operations. Do not use raw `docker compose`, raw `docker build`, or direct harness commands unless the CLI lacks the needed operation and you explain why.

Prefer isolated runs when another session may be using showcase:

```sh
showcase/bin/showcase test <slug> --d5 --verbose --cycle --isolate
```

## Baseline Rules

- Keep showcase demo code on CopilotKit v2 APIs.
- Treat `showcase/integrations/langgraph-python` as the gold standard for D5 behavior. Every other showcase demo must be a 1:1 match to `langgraph-python` for the same demo behavior, prompts, pills, tool flow, UI assertions, and D5 coverage unless the user explicitly approves a documented divergence.
- For new or migrated demos, compare dependency versions against `showcase/integrations/langgraph-python` before implementation and keep the same versions or newer unless the user explicitly approves a documented divergence.
- Use Google ADK as extra context only when it is relevant.
- For any D5 cell or migration, make every pill work against a real agent first, then implement fixtures, then run the local D5 validation until green.
- E2E tests for migrated demos should match the `langgraph-python` behavior and assertions unless the user explicitly approves a divergence.
- Every pill in a demo must be exercised and covered by aimock-backed D5 replay before the demo is complete.
- When implementing a new feature, click every suggestion pill in the demo and verify it works before declaring the feature complete.
- With aimock replay, fixture behavior must be stable when a pill is clicked once, clicked five times in a row, clicked after another pill, and clicked again after intervening pills. The same pill should produce the same expected output for the same fixture-backed prompt regardless of prior pill order.
- Verify locally before saying a fix or demo is done.
- Do not weaken a demo to satisfy a test. The demo behavior is the product.

## New Showcase Items

Use this workflow when creating a new showcase item, adding a new demo cell, adding suggestion pills, or implementing a new showcase feature. The same rules apply as debugging:

1. Read the current showcase guides listed above.
2. Find the matching `langgraph-python` demo or define the new `langgraph-python` behavior first.
3. Compare dependencies with `showcase/integrations/langgraph-python`; use the same versions or newer for shared demo/runtime/test dependencies unless a documented incompatibility requires otherwise.
4. Implement the demo behavior with CopilotKit v2 APIs and make every suggestion pill work against a real agent.
5. If any local step talks to a real LLM, run it through aimock record mode so fixtures are captured.
6. Convert recordings into deterministic source D5 fixtures.
7. Verify every pill once, repeated, and interleaved under aimock replay.
8. Add or update D5 E2E coverage for every pill.
9. Run local validation before marking the new showcase item complete.

Do not treat new showcase work as done after the UI appears to work once. New demos need the same fixture consistency, replay stability, and regression coverage as bug fixes.

## Bug Investigation Loop

1. Read the relevant demo, D5 script, and existing fixtures before reproducing.
2. Determine whether the flow is using aimock or a real LLM:
   - Inspect `showcase/docker-compose.local.yml`, provider base URLs, and `showcase/harness/fixtures/d5/*.json`.
   - Check whether the matching fixture exists in `showcase/aimock/d5-all.json` or source fixtures under `showcase/harness/fixtures/d5/`.
   - Use `showcase/bin/showcase logs aimock --grep "fixture|match|NO match|404"` after a run.
3. If the flow is supposed to use aimock, reproduce with:
   ```sh
   showcase/bin/showcase up aimock <slug>
   showcase/bin/showcase test <slug> --d5 --verbose --cycle
   ```
4. If fixtures look suspect, run aimock locally and inspect fixture matching before editing app code.
5. If the flow bypasses aimock and talks directly to a real LLM, always run aimock in record mode locally for that step. Do not run an unrecorded real-LLM local flow. Use the recorded fixture output to make later replay deterministic and to reach aimock-backed D5 coverage.
6. Once root cause is pinpointed and a fix is implemented, ask the user to click through the exact flow and confirm it works before locking the regression coverage.
7. After the user confirms, add or update D5 fixtures and regression E2E coverage so the issue cannot silently return.
8. For every additional issue the user reports while clicking around, repeat this same loop: reproduce, root cause, user verification, fixture, regression test.

## Environment Setup

If a real LLM provider is needed, inspect `showcase/.env` without printing secret values. If the required key is missing or empty:

1. Ensure `showcase/.env` exists, copying from `showcase/.env.example` if needed.
2. Open it for the user:
   ```sh
   code --new-window "F:\projects\cpk\CopilotKit\showcase\.env"
   ```
3. Ask the user to paste the required key, usually `OPENAI_API_KEY`; use `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY` only when the target provider needs it.
4. Ask the user to tell you when the file is saved. Do not ask them to paste secrets into chat.

If env/config changes affect containers, use:

```sh
showcase/bin/showcase recreate <slug>
```

Use rebuild only for dependency, Dockerfile, or non-mounted source changes.

## Reproducing Interactively

If the user says they will reproduce manually, start the needed local services and ask them to click through the flow, then tell you when finished so you can inspect logs and recorded fixtures.

If the user asks you to reproduce from instructions, run the showcase demo in headed Playwright or the Browser MCP, interact until the bug is reproduced, and preserve the exact steps, prompt text, selected pill, URL, and observed failure.

Use headed D5 when useful:

```sh
showcase/bin/showcase test <slug> --d5 --headed --verbose --cycle
```

## Recording Fixtures

For a new demo or any local step that talks to a real LLM, run aimock in record mode so the interaction becomes fixture-backed. This is mandatory: real-provider traffic should produce fixtures that can be replayed later.

```sh
docker compose -f showcase/docker-compose.local.yml -f showcase/docker-compose.record.yml --profile infra up -d aimock <slug>
```

This record-mode compose override is the accepted exception to the normal "use `showcase/bin/showcase`" rule until the showcase CLI has a first-class record command.

Then drive every pill in the demo manually or with the D5 harness. Recorded calls land under `showcase/aimock/d5-recorded/`.

After recording:

1. Convert or move recorded output into source D5 fixtures under `showcase/harness/fixtures/d5/`.
2. Ensure `showcase/aimock/d5-all.json` contains the replay fixture path required by current docs/scripts.
3. Run fixture validation.
4. Re-run the demo with aimock replay only.
5. Add or update D5 E2E coverage for every pill.

When using the existing D5 recorder helper, read `showcase/scripts/record-d5-fixtures.mjs` first. It documents the current recorder patch requirement for multi-turn fixtures. If aimock cannot record the needed response shape, do not fake the behavior in the demo; discuss the smallest upstream aimock change with the user.

## Pill Replay Stability

When adding a feature, changing fixtures, or debugging any fixture-backed demo, verify suggestion-pill stability under aimock replay:

1. Click each suggestion pill once in a fresh session and confirm the expected UI and assistant output.
2. Click each suggestion pill repeatedly, including at least five consecutive clicks for pills that exercise LLM/tool behavior.
3. Click multiple different pills one after another, then return to a previously clicked pill and confirm it still produces the same expected output.
4. Inspect aimock logs for fixture misses, incorrect matches, repeated stale matches, or order-dependent matches.
5. Fix fixture matching if output depends on click order, prior pills, or how many times the same pill was clicked.

Fixtures must be consistent and replayable. Do not rely on `turnIndex` or conversation history when a stable `userMessage`, `toolCallId`, `hasToolResult`, or more specific fixture key can make the replay deterministic across repeated and interleaved pill clicks.

## Fixture Rules

- Source fixtures live under `showcase/harness/fixtures/d5/*.json`.
- Bundled runtime fixtures live in `showcase/aimock/d5-all.json`.
- Use `toolCallId` for multi-turn disambiguation when a stable tool id exists; use `hasToolResult` only when the exact tool id is unavailable or intentionally runtime-variable.
- Do not introduce `turnIndex` in new fixtures unless no stable request property can distinguish the turn and the divergence is documented.
- Prefer stable, specific `userMessage`, `systemMessage`, `toolCallId`, and tool-surface matching. Avoid broad catch-alls that can steal another pill's fixture.
- After fixture edits, validate and recreate aimock:
  ```sh
  showcase/bin/showcase fixtures validate
  showcase/bin/showcase recreate aimock
  showcase/bin/showcase test <slug> --d5 --verbose --cycle
  ```
- If adding a new fixture file, update the compose mount and aimock Dockerfile copy rules when the current docs require it.

## Regression Tests

Add regression coverage after the user confirms the fixed flow works:

- Add or update the D5 fixture for the exact prompt/pill/tool flow.
- Add an E2E regression that fails on the original bug and passes with the fix.
- Cover every pill in the demo, including pills that only exist to expose edge cases.
- Include repeated and interleaved pill-click coverage when fixtures are involved, so a fixture cannot pass only on a single first click.
- Match the langgraph-python D5 assertion style and behavior 1:1 for equivalent demos.
- Include every separate user-reported demo issue as its own covered behavior unless a single test naturally covers the shared root cause.
- Run the narrow relevant D5 test first, then broader showcase validation when the change touches shared fixtures, harness logic, runtime behavior, or multiple demos.

## Aimock Upstream Gaps

If aimock lacks a feature needed to accurately replay the LLM provider response:

1. Confirm the gap with a recorded provider response or logs.
2. Avoid adding demo workarounds that hide the mismatch.
3. Ask the user what the easiest way is for you to file the upstream PR.
4. If approved, make the smallest aimock change, rebuild with:
   ```sh
   showcase/bin/showcase aimock-rebuild --from <aimock-source-path>
   ```
5. Re-run the showcase D5 flow with the rebuilt aimock.

## Done Criteria

Before final status:

- The root cause is stated concretely.
- The affected local showcase demos are running and their local URLs are provided in the overview so the user can manually test the fixed flows.
- The user has confirmed the fixed UI flow when manual verification was requested.
- Fixtures are deterministic and validated.
- Any real-LLM local run was routed through aimock record mode and produced replayable fixtures.
- Every pill in the affected demo has aimock-backed D5 coverage.
- Aimock fixture replay is stable for single, repeated, and interleaved suggestion-pill clicks.
- Non-`langgraph-python` demo behavior matches `langgraph-python` 1:1 or has an explicit documented user-approved divergence.
- The relevant D5/e2e regression is present and passing locally.
- Any aimock limitation is either fixed upstream, linked to an upstream PR/plan, or explicitly called out as a blocker.
