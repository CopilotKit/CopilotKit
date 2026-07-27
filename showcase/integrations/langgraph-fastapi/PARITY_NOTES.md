# langgraph-fastapi — parity notes

Tracks where this integration **intentionally** diverges from the
`langgraph-python` north star. Everything not listed here is expected to be
byte-identical (modulo the integration's own name/title). `fe-parity.ts` reads
the machine-readable allowlist block below and reports these files as
`ALLOWED` (sanctioned) instead of `DRIFT`, so the parity gate is not driven
toward an impossible goal.

**Rule for agents:** if a file is listed below, it is different **on purpose** —
do not "fix" it to match langgraph-python. If you think an entry is wrong,
verify with D6 first (`bin/showcase test langgraph-fastapi:<demo> --d6`) and
discuss before changing.

<!-- fe-parity-allow
app/demos/a2ui-recovery/suggestions.ts | a2ui-recovery fixtures carry NO x-aimock-context, so each integration MUST use a UNIQUE pill prompt or fixtures collide across integrations. fastapi's prompt ("Put together a quarterly metrics overview…") differs from langgraph-python's ("Build my Q2 revenue summary…") by design. See harness/src/probes/scripts/d5-a2ui-recovery.ts ("per-framework prompt isolation, load-bearing"). Verified: aligning to LGP's prompt makes aimock fail to match (STRICT no-match). NOTE: a2ui-recovery ALSO has a separate DOM-level D6 red (surface-missing) that is NOT a fastapi defect — it reproduces identically on the langgraph-python north star (shared Python ag_ui_langgraph recovery loop). See the "a2ui-recovery — D6 red is a shared north-star defect" section below. Do not "fix" it by byte-aligning the prompt.
app/demos/a2ui-recovery/chat.tsx | Consequence of the unique-prompt design above: this integration does not inject the declarative-gen-ui sales-context hook into the recovery demo (the backend prompt + fixtures carry the dataset). Kept as fastapi's own working version.
app/demos/a2ui-recovery/page.tsx | Per-slug backend path reference in the doc comment (src/agents/src/recovery_agent.py — fastapi nests agents under src/agents/src/, langgraph-python uses src/agents/). Cosmetic comment divergence, not behavior.
-->

## a2ui-recovery — per-slug prompt isolation

The `a2ui-recovery` demo is the one place this integration cannot be
byte-identical to `langgraph-python`. Its aimock fixtures do not send the
`x-aimock-context` routing header, so aimock can only disambiguate integrations
by the prompt text itself. Each integration therefore keeps a distinct pill
prompt, and its `a2ui-recovery.json` fixtures are keyed to that prompt. The
frontend (`suggestions.ts`, and consequently `chat.tsx`/`page.tsx`) and the
fixture stay in lockstep per integration. Aligning them to langgraph-python
breaks fixture matching (`aimock: STRICT no fixture matched` → agent error →
D6 red).

A deeper fix would be to add context routing to the a2ui-recovery flow so all
integrations could share one prompt — out of scope here.

## a2ui-recovery — D6 red is a shared north-star defect (not fastapi)

Separate from the prompt-isolation divergence above, the `a2ui-recovery` D6
cell is currently **red at the DOM level (`surface-missing`)**, and this is
**not** a fastapi-specific bug — it **reproduces identically on the
`langgraph-python` north star**. So fastapi is already behaviorally aligned
with LGP here; there is nothing to fix under `integrations/langgraph-fastapi/`.

Live-trace findings (2026-07-27):

- The HEAL turn never paints the ≥2 `declarative-metric` tiles the probe
  requires. The validate→retry loop does not reliably advance
  seq0(invalid)→seq1(valid): narration claims "I recovered and painted your
  metrics overview" while the DOM shows the hard-fail card "Couldn't generate
  the UI." Worker log: `waitForTurnComplete: turn 1 did not complete …
  reason=surface-missing`.
- The failing run's second SSE stream balloons to ~13 MB (`transferSize`
  ~12–14M on both fastapi and LGP) vs a clean short stream on the green
  sibling — consistent with the recovery loop over-iterating / re-emitting
  instead of stopping at the healed surface.
- **mastra** (TypeScript `getA2UITools`) is reliably green (3/3), so the demo
  itself is achievable. fastapi, LGP, and google-adk share the **Python**
  `ag_ui_langgraph.get_a2ui_tools` (v0.0.41, a pip dependency in the agent
  container — not in this repo), which is the suspected locus.
- Ruled out via trace: aimock no-match/404/STRICT (none), `injectA2UITool`
  (present, correct), catalog registration (`defaultCatalogId:
  "declarative-gen-ui-catalog"`, identical to LGP), and any fastapi wiring
  drift (`route.ts`, `recovery_agent.py`, `langgraph.json` are structurally
  identical to LGP).

Fixing the shared Python recovery loop is tracked as a **separate PR against
the north star / the `ag_ui_langgraph` package**, not in this fastapi
alignment branch. A single one-off green does not reproduce — do not treat a
lone green run as "fixed".
