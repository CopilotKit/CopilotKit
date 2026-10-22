# Shared catalog ordering: follow-up verification

This follow-up tests the shared standard catalog after deleting the demo's Python
ordering policy. It is separate from the earlier [60-request paired experiment](ordering-results.md).
The shared implementation is commit `141225ad46619712ff7cd1cd534b13593bc17763`;
the demo includes its cherry-pick `fa48907bb9` and consumes received metadata.

## Deterministic checks

- All 69 adapter property orders equal the actual portable catalog JSON export.
- The demo's generated Express guide is byte-for-byte identical to the earlier
  ordered guide. Ownership changed; the measured calling conventions did not.
- Six positional/named call pairs compile identically and pass component schema
  validation using the portable JSON directly with `a2ui-agent-sdk==0.9.0` and
  `a2ui-core==0.4.0`. Run `verify_catalog.py` as described in the [benchmark README](README.md).
  This check imports neither the demo compiler nor a local ordering policy.
- The demo's 78 Python tests pass, including custom catalogs, malformed metadata,
  no-metadata fallback and preservation of input/schema values.

## Eight fresh API-key runs

Gemini 3.6/3.8 Flash × Express markdown/tool × dashboard/team estimator, one
attempt each. Explicit medium thinking, concurrency two, fresh sessions,
120-second timeout and no automatic repair. Inputs contain the newly exported
shared component metadata. All attempts are retained.

**5/8 passed compilation, schema/graph validation and initial expression evaluation.**
All four dashboard attempts passed; one of four estimator attempts passed. This
is an integration smoke test without a matched baseline, not a fresh estimate of
the ordering improvement. No browser interaction guarantee follows from these counts.

| Model            | Transport | Prompt                | First model output (s) | Total (s) | Schema/graph + initial expressions |
| ---------------- | --------- | --------------------- | ---------------------: | --------: | ---------------------------------- |
| gemini-3.6-flash | markdown  | Dashboard on the page |                  10.38 |     12.89 | Pass                               |
| gemini-3.6-flash | markdown  | Team plan estimator   |                  22.27 |     25.75 | Fail                               |
| gemini-3.6-flash | tool      | Dashboard on the page |                  10.27 |     10.34 | Pass                               |
| gemini-3.6-flash | tool      | Team plan estimator   |                  26.35 |     26.50 | Pass                               |
| gemini-3.8-flash | markdown  | Dashboard on the page |                   8.48 |     14.60 | Pass                               |
| gemini-3.8-flash | markdown  | Team plan estimator   |                  34.94 |     43.42 | Fail                               |
| gemini-3.8-flash | tool      | Dashboard on the page |                  31.21 |     31.28 | Pass                               |
| gemini-3.8-flash | tool      | Team plan estimator   |                  25.85 |     25.91 | Fail                               |

The failures were:

- 3.6/markdown estimator: `Text(size="2xl")`, outside Text's permitted size enum.
- 3.8/markdown estimator: `series` compiled with string-valued `args` (`"m"`),
  rejected because function args must be an object.
- 3.8/tool estimator: the same `series` argument-shape failure (`"i"`). This
  appeared as a `TOOL_CALL_RESULT` error with no create, even though the run ended
  with `RUN_FINISHED`. A finished run alone is therefore not a success criterion.

None demonstrates that removing the local policy changed argument order; the
complete order and generated-guide equivalence checks above passed. These
remaining model-output failures still need independent investigation.

## Live browser checks

Two additional fresh dashboard requests through the running Next.js demo, one
per model using Express/markdown, both rendered visible dashboards with no page
or renderer error markers. Screenshots were inspected. These used the normal
demo model settings and are not part of the eight explicitly-medium requests.

The captured browser requests included the shared `Text.parameterOrder` starting
with `text, children`, proving the real frontend sends the new metadata. First
surface paint was 10.23 seconds on 3.6 and 14.50 seconds on 3.8 from browser send;
completion was 10.54 and 14.72 seconds. These two samples do not establish a
latency improvement, numerical correctness of generated sales data, or full
interaction correctness.

Raw inputs, outputs, timings, validation/evaluation scripts and screenshots are
retained in the local `shared-catalog-order-verification-2026-10-21.tar.gz` evidence
bundle. API keys and thought content are excluded. The older study bundle had a
source-snapshot filename collision between its policy and benchmark scripts;
this bundle includes the original policy recovered from commit `f440d24ff7` under
a distinct name. Recorded runs, signatures and statistics were unaffected.
