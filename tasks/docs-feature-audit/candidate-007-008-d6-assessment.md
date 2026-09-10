# CONTENT-GEN-007 and CONTENT-GEN-008 D6 assessment

Date: 2026-09-10. Scope: determine whether the current strict D6 scripts and
their isolated AIMock fixtures can prove the two reported data paths. This is
an audit artifact; it makes no source or fixture changes.

## Result

Neither existing D6 assertion is a discriminating proof of its candidate path.

| Finding                                 | Current D6 result                                 | What the test actually proves                                                         | Assessment                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTENT-GEN-007` Built-in Agent config | The historical local D6 run passed all six turns. | Controls changed, requests completed, and fixtures produced different canned replies. | Does **not** prove `useAgentContext` reached the factory's `input.forwardedProps`. Source-contract evidence still confirms the channels diverge.    |
| `CONTENT-GEN-008` Strands recipe        | No focused Strands local result is available yet. | The script checks a visible recipe card, a non-empty reply, and recipe-related words. | Does **not** prove an edited `state.recipe` reached the model; each reply is selected by its user-message matcher. It remains a behavior candidate. |

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

## Smallest valid targeted tests after the defect-register phase

1. **Built-in Agent:** retain a single neutral user prompt across two control
   values and capture the runtime POST body. Assert the changed values occur
   in `forwardedProps` consumed by the factory, rather than merely in the
   protocol `context` collection. No live model judgment is needed.
2. **Strands:** edit the recipe title to a unique sentinel, submit a neutral
   prompt, and assert the outbound model request contains that sentinel. An
   AIMock fixture or request interceptor must make the response conditional on
   the sentinel; a canned response keyed only by the user prompt is not
   sufficient.

These are proposed post-register test improvements, not an instruction to edit
the tests or fixtures during this audit.
