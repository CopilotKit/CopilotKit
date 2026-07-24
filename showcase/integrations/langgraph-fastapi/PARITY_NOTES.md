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
app/demos/a2ui-recovery/suggestions.ts | a2ui-recovery fixtures carry NO x-aimock-context, so each integration MUST use a UNIQUE pill prompt or fixtures collide across integrations. fastapi's prompt ("Put together a quarterly metrics overview…") differs from langgraph-python's ("Build my Q2 revenue summary…") by design. See harness/src/probes/scripts/d5-a2ui-recovery.ts ("per-framework prompt isolation, load-bearing"). Verified: aligning to LGP's prompt makes aimock fail to match (STRICT no-match). NOTE: a2ui-recovery also has a separate DOM-level D6 failure currently under investigation (tracked in the red-demo inventory) — independent of this frontend divergence; do not "fix" it by byte-aligning the prompt.
app/demos/a2ui-recovery/chat.tsx | Consequence of the unique-prompt design above: this integration does not inject the declarative-gen-ui sales-context hook into the recovery demo (the backend prompt + fixtures carry the dataset). Kept as fastapi's own working version (D6 green).
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
