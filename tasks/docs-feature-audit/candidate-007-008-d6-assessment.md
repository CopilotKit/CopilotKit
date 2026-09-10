# CONTENT-GEN-007 and CONTENT-GEN-008 D6 assessment

Date: 2026-09-10. Scope: determine whether the current strict D6 scripts and
their isolated AIMock fixtures can prove the two reported data paths. This is
an audit artifact; it makes no source or fixture changes.

## Result

Neither existing D6 assertion is a discriminating proof by itself. Focused
audit-only captures below now confirm the underlying defects.

| Finding                                 | Current D6 result                                                                             | What the test actually proves                                                         | Assessment                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `CONTENT-GEN-007` Built-in Agent config | Historical D6 passed; then an isolated browser capture ran.                                   | The capture put changed controls in `context` and sent empty `forwardedProps`.        | **Confirmed:** the factory consumes the empty channel and falls back to defaults.                                 |
| `CONTENT-GEN-008` Strands recipe        | No focused full host result; the registered state bridge was directly invoked with sentinels. | Recipe state is omitted while the preferences control reaches the constructed prompt. | **Confirmed at the installed state-context bridge.** A full framework-adapter capture would only be supplemental. |

## Evidence

### Built-in Agent configuration

- The D6 script changes a control and deliberately sends distinct value-bearing
  user prompts (`d5-agent-config.ts:41-79`). Its fixture is selected by those
  `userMessage` values plus the integration context, not by a forwarded
  property (`aimock/d6/built-in-agent/agent-config.json:9-65`). Different
  replies are therefore expected even if the control value never reaches the
  factory.
- The recorded local D6 run completed six agent-config turns successfully
  (`built-in-agent-host-d6-esm.log:1984-2204`), but its transcript assertion is
  subject to that fixture selection.
- **Focused isolated capture (2026-09-10):** a separate Next process listened
  at `127.0.0.1:3127`; a temporary Playwright interceptor captured and aborted
  the `agent/run` request before it reached the route handler or AIMock. After
  selecting `enthusiastic` / `expert` / `detailed` and sending the neutral
  `AUDIT_NEUTRAL_SENTINEL_BIA_7f3c9a` message, the captured input placed the
  three values in one `context` entry and used `forwardedProps: {}`. This is an
  unchanged-source local request capture, not a fixture result.
- The client core treats properties and agent context as separate protocol
  fields: properties are sent as `forwardedProps` (`packages/core/src/core/core.ts:60-75`,
  `core-basic-functionality.test.ts:41-52`), while `useAgentContext` entries
  populate `context` (`context-store.ts:45-58`,
  `core-context-injection.test.ts:35-54`). The runtime parses and passes that
  structured input through (`runtime/handlers/handle-run.ts:51-105`).
- The demo publishes the controls through agent context, while its factory
  consumes only forwarded properties. This confirms `CONTENT-GEN-007` as a
  source-contract wiring defect; it does not depend on the fixture result.

### Strands recipe

- The shared-state D6 script itself says its prompts must retain the
  `userMessage` fixture-routing tokens (`d5-shared-state-read.ts:36-40`) and
  accepts a reply with any broad recipe-related word
  (`d5-shared-state-read.ts:147-165`).
- The Strands fixture matches only the Italian/healthy prompt substrings,
  turn index, and integration context. It has no matcher for the UI recipe
  value (`aimock/d6/strands/shared-state-read.json:10-27`). Its canned reply
  already contains the words the assertion accepts.
- This test can catch a missing UI/chat surface or a fixture-routing failure,
  but it cannot distinguish a backend that sees the current recipe from one
  that ignores it.
- **Focused direct bridge execution (2026-09-10):** the unchanged
  `build_state_prompt` function was imported with the same lightweight test
  dependency stubs used by the integration's Python unit suite. With
  `recipe.title = AUDIT_RECIPE_SENTINEL_7f3c9a`, the result was the neutral
  user request alone and omitted the sentinel. A paired
  `preferences.name = AUDIT_PREFERENCE_SENTINEL_7f3c9a` control appeared in
  the prompt. This runs the registered bridge itself; it is not a full
  ag_ui_strands transport capture.

## Post-register regression tests

1. **Built-in Agent:** retain a single neutral user prompt across two control
   values and assert the runtime POST body puts them in `forwardedProps`
   consumed by the factory, rather than merely in `context`. No live model
   judgment is needed.
2. **Strands:** edit the recipe title to a unique sentinel, submit a neutral
   prompt, and assert the outbound model request contains that sentinel. An
   AIMock fixture or request interceptor must make the response conditional on
   the sentinel; a canned response keyed only by the user prompt is not
   sufficient.

These are proposed post-register test improvements, not an instruction to edit
the tests or fixtures during this audit.
