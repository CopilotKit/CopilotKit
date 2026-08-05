# CrewAI Full D6 Design

**Date:** 2026-08-05

**Status:** Approved for planning

**Integration:** `showcase/integrations/crewai-crews`

**Target:** Genuine 41/41 D6 coverage with connected documentation

## Context

The CrewAI showcase was built against `ag-ui-crewai==0.2.0` and currently
advertises a partial D6 surface. Its manifest maps 37 D6 feature types, marks
several of those incapable, and omits four feature families that already have
some frontend or backend scaffolding. Several integration-local workarounds
also compensate for limitations that have since been fixed upstream.

The partnership refresh produced a new `ag-ui-crewai` bridge with native
support for the missing protocol behaviors. The release-candidate artifact for
this work is:

```text
ag-ui-crewai==0.0.0.dev1785927675
```

The candidate is published on TestPyPI and depends on the matching
`ag-ui-protocol==0.0.0.dev1785927675`. It supports CrewAI `>=1,<2`. This work
uses that artifact to validate the future official release. TestPyPI is not the
permanent installation story, and the eventual official release update should
be isolated to dependency configuration.

## Goals

1. Run all 41 shared D6 feature probes for CrewAI without capability skips.
2. Exercise native `ag-ui-crewai` behavior instead of showcase-local protocol
   emulation.
3. Keep feature frontends shared or near-identical and keep CrewAI backends
   minimal.
4. Validate the release candidate through aimock and real-LLM execution.
5. Make every CrewAI showcase feature lead to correct, navigable connected
   documentation.
6. Leave the integration ready for a small, explicit switch from the dev
   artifact to the official package.

## Non-goals

- Building the postponed full Crew middleware/HITL/state project. Advanced
  feature demos remain Flow-based where the bridge needs Flow semantics.
- Changing the shared D6 probe contract to accommodate CrewAI.
- Adding CrewAI-specific branches to shared frontend code.
- Claiming support through `not_supported_features` skips.
- Publishing TestPyPI installation instructions as product documentation.
- Fixing bridge defects inside CopilotKit. Any confirmed bridge defect is
  reported upstream and kept out of showcase glue.

## Approaches Considered

### 1. Incremental native-bridge adoption — selected

Upgrade the release candidate, delete obsolete workarounds, and implement only
the thin Flow adapters needed by the shared demos. Enroll features as their
shared probes pass.

This keeps the diff explainable, validates the public bridge API directly, and
preserves the showcase architecture.

### 2. Manifest-first enablement

Remove capability skips and then chase the resulting failures. This is quick to
start but creates noisy red coverage, makes it easier to mistake declarations
for implementation, and does not force removal of obsolete workarounds.

### 3. Wholesale rewrite from upstream examples

Replace the CrewAI integration with the bridge's example applications. This
would demonstrate the bridge but risks frontend and fixture drift, expands the
change surface, and weakens comparison with the LangGraph reference cells.

## D6 Success Contract

`d6-all-pills.ts` is the acceptance surface. It maps the integration manifest to
all feature types and runs the same shared probe used by every other
integration. CrewAI-specific differences may appear only in its D6 fixtures.

Success means:

- 41 mapped feature types;
- 41 capable feature types;
- zero CrewAI entries in `not_supported_features`;
- no CrewAI conditionals in shared D6 probes;
- no per-integration copies of shared probes or shared frontend features;
- all aimock probes green using CrewAI's own fixtures;
- selected model-dependent paths green against a real LLM;
- all connected-doc links resolve to relevant content.

The 41/41 result is behavioral, not an aggregate dashboard color. A skipped
incapable cell does not count.

## Architecture

### Dependency boundary

During release-candidate validation, the CrewAI requirements resolve the exact
dev build and its matching protocol build from TestPyPI. The candidate source
must be explicit so fresh local, Docker, and CI installs reproduce the same
environment.

The dependency change will be kept separate from application behavior where
practical. When the official package is available, replacement should require
only:

1. replacing the dev bridge pin;
2. replacing or removing the matching dev protocol pin;
3. removing the TestPyPI source configuration;
4. regenerating any lock or Docker override that mirrors those pins.

No docs page should instruct users to install the dev artifact.

### Backend boundary

The agent server remains one FastAPI application with dedicated paths for
feature-specific Flow or Crew adapters and a shared Crew fallback at `/`.
Dedicated paths must be registered before the catch-all route.

Use Crew endpoints for ordinary chat behavior. Use Flow endpoints for features
that require explicit state mutation, pause/resume, orchestration, or streaming
control. This reflects current bridge capabilities without expanding the
postponed bare-Crew project.

Native bridge surfaces replace local protocol emulation:

| Capability              | Native bridge path                               | Showcase direction                                                         |
| ----------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| Reasoning               | first-class `REASONING_*` events                 | remove the custom reasoning ASGI sub-app                                   |
| Flow HITL               | feedback provider plus resume/checkpoint support | replace frontend-tool “adapted interrupt” backend                          |
| Interrupt outcomes      | `emit_interrupt_outcome=True`                    | opt in on HITL endpoints used by D6                                        |
| Shared state            | state snapshot/delta helpers                     | add minimal read and streaming Flows                                       |
| Forwarded props/context | bridge input preparation                         | remove raw request-body middleware if parity tests prove it redundant      |
| MCP                     | native CrewAI MCP event translation              | replace stale “unsupported” assumptions and validate the existing MCP demo |
| Multimodal              | preserved message content parts                  | add a dedicated vision-capable backend path                                |
| A2UI                    | bridge A2UI toolkit and injection controls       | preserve schema-loading behavior and add recovery coverage                 |
| Checkpointing           | bridge checkpoint/resume support                 | use it for true Flow interrupts                                            |

Local middleware that serves independent observability or header-forwarding
needs may remain. It must not duplicate protocol behavior now owned by the
bridge.

### Frontend boundary

The existing feature frontends remain unchanged unless comparison finds they
have already drifted from the shared/reference implementation. Any necessary
frontend correction is made at the shared source and then consumed by CrewAI.

The load-bearing `tools` and `_shared` symlinks must remain symlinks. The task
must not replace them with copied directories.

### Fixture boundary

All integration-specific model behavior belongs under CrewAI's D6 fixture
directory. Fixtures may encode prompts, streamed responses, tool calls,
reasoning deltas, state updates, and resume turns needed by CrewAI's backend.
They may not change probe assertions or frontend behavior.

## Feature Workstreams

### Native reasoning

Replace the custom reasoning application with a thin Flow or Crew endpoint that
uses the release candidate's provider-agnostic reasoning channel. Validate both
default and custom reasoning renderers and the combined reasoning/tool chain.
Reasoning-capable fixtures and the real-LLM smoke must produce actual
`REASONING_*` events; plain text that resembles a chain of thought is not
sufficient.

### True interrupts

Replace the `interrupt-adapted` frontend-tool strategy with native async Flow
HITL. The Flow must make an LLM call before the pause and another after resume,
persist the checkpoint by thread/run identity, and register its endpoint with
`emit_interrupt_outcome=True`.

Both `gen-ui-interrupt` and `interrupt-headless` must traverse the shared pause,
user decision, resume, and completion contract. Cancellation and rejection must
end cleanly without leaving an open tool, step, message, or reasoning sequence.

### Shared state

Add minimal Flow endpoints for read-only state and per-token or incremental
state streaming. Preserve the existing read/write Flow. State must be visible
through protocol state events, not reconstructed from assistant text.

### Multimodal

Create a dedicated multimodal backend endpoint instead of routing attachment
messages through the generic catch-all Crew. Preserve structured text/image/PDF
content through the bridge and select an LLM path that accepts the content
shape. Keep attachment-specific prompting out of unrelated demos.

### MCP Apps

Exercise the release candidate's native MCP listener/translation path with the
existing MCP Apps route. Remove stale code comments and parity notes that claim
the primitive is unavailable. Confirm lifecycle events, tool arguments,
results, and rendered app content through the shared probe.

### A2UI recovery

Add the missing recovery scenario using the bridge's A2UI toolkit. A malformed
or rejected first attempt must be followed by a valid surface without breaking
the run. Keep fixed-schema and dynamic-schema behavior intact.

### Enrollment gaps

Add manifest demo declarations for the four probe families that currently have
implementation scaffolding but are not fully enrolled:

- reasoning display (`reasoning-custom` and `reasoning-default`);
- shared-state read;
- BYOC declarative Hashbrown and JSON Render;
- A2UI recovery.

Exact manifest IDs must follow the D6 registry rather than introducing CrewAI
aliases.

## Connected Documentation

CrewAI uses `docs_mode: authored`. Its URL slug is `crewai-crews`, while
`getDocsFolder()` resolves its authored content to:

```text
showcase/shell-docs/src/content/docs/integrations/crewai-flows/
```

For every enrolled feature:

1. prefer an explicit `docs-links.json` override when CrewAI's authored path
   differs from the global feature registry;
2. otherwise verify the global fallback resolves to relevant content;
3. add missing authored pages or shared-content links for genuine gaps;
4. update `meta.json` when an authored page is added or moved;
5. verify the route, active sidebar entry, search result, source snippet, and
   framework switcher behavior.

The declarative Hashbrown and JSON Render routes are known gaps and must receive
valid connected-doc destinations. Links must not point to a different CrewAI
product merely because a similarly named page exists.

## Error Handling and Diagnostics

- A bridge import or dependency-resolution failure must fail startup loudly.
- Endpoint registration errors must identify the feature path.
- Flow failures must emit a valid terminal AG-UI error sequence and close any
  open message, tool, step, or reasoning lifecycle.
- Resume with a missing or invalid checkpoint must return a deterministic error
  rather than silently starting a new run.
- Unsupported content from a multimodal request must produce a clear error and
  must not corrupt later requests.
- Aimock fixtures must be deterministic; a fixture miss must not fall through
  to an unintended paid LLM call.
- Candidate bridge defects are minimized to a reproducible upstream report.
  CopilotKit must not grow a bridge fork or monkey patch to conceal them.

## Testing Strategy

### Baseline and focused tests

Before behavior changes, capture failing direct D6 probes for at least three of
the target cells. Add or update focused Python tests only for integration glue
that CopilotKit owns. Tests that merely duplicate `ag-ui-crewai` unit coverage
are out of scope.

### Shared D6 probes

Run direct D6 probes while developing each feature, then run the all-pills D6
driver for `crewai-crews`. The final report must distinguish executed passes
from skips and include a 41/41 capability count.

### Aimock

Record or update only `showcase/aimock/d6/crewai-crews` fixtures. Verify
determinism with repeat runs, including multi-turn HITL/resume and A2UI recovery.

### Real LLM

Run model-backed checks for behavior that canned fixtures cannot prove:

- reasoning deltas;
- pre-interrupt and post-resume Flow execution;
- multimodal content handling;
- MCP tool execution and result translation;
- state streaming timing;
- A2UI recovery after an invalid first generation.

Real-LLM success complements aimock D6; it does not replace the shared probe
contract.

### Documentation

Run registry/docs validation and exercise representative feature links in the
shell docs application. Check direct URL load, sidebar state, search, snippets,
and framework switching for newly connected features.

### Regression and hygiene

- run manifest and pin validation;
- run the CrewAI focused Python suite;
- run affected frontend typechecks/tests through Nx where targets exist;
- verify `tools` and `_shared` remain symlinks;
- verify the worktree is clean except for intentional changes;
- run the repository's completion and review gates before handoff.

## Commit Shape

Keep commits independently reviewable:

1. release-candidate dependency wiring and compatibility baseline;
2. removal of obsolete middleware/reasoning workarounds with native coverage;
3. native Flow HITL and interrupt demos;
4. state, multimodal, MCP, and A2UI recovery backends/fixtures;
5. manifest 41/41 enrollment and connected docs;
6. final fixture and validation adjustments.

Tests belong in the commit that introduces the behavior. Push each meaningful
commit to the draft PR as required by repository workflow.

## Acceptance Criteria

- [ ] `ag-ui-crewai==0.0.0.dev1785927675` is reproducibly installed for the
      validation branch with its matching protocol build.
- [ ] Switching to the future official package is dependency-only work.
- [ ] CrewAI maps to 41 D6 feature types and declares zero unsupported types.
- [ ] All 41 shared D6 probes execute and pass under aimock.
- [ ] Selected real-LLM checks pass for reasoning, HITL/resume, multimodal, MCP,
      state streaming, and A2UI recovery.
- [ ] Obsolete forwarded-props, reasoning, and adapted-interrupt workarounds are
      removed where the native bridge supersedes them.
- [ ] No shared probe contains a CrewAI-specific branch.
- [ ] No shared frontend is copied or forked for CrewAI.
- [ ] CrewAI-specific behavior exists only in minimal backend adapters and its
      D6 fixtures.
- [ ] Every feature has a relevant connected-doc destination, including both
      declarative BYOC variants.
- [ ] Authored docs navigation, search, snippets, and framework switching work.
- [ ] Shared symlinks remain intact.
- [ ] Candidate bridge defects, if any, are reported upstream rather than
      patched locally.
