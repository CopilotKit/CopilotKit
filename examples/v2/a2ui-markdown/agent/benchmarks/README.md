# Live parameter-order study

The completed [60-attempt report](ordering-results.md) includes reliability,
latency, token usage and browser checks. [Per-attempt data](ordering-runs.csv)
retains failures as well as successes.

`parameter_order.py` compares the current Express compiler with a frozen copy of
the compiler before ordering changed. It uses real API-key Gemini requests via
ADK, fresh sessions, and the same frontend context and prompts in both arms.
It does not exercise automatic frontend repair turns. It never logs thought
content or credentials; the raw synthetic UI output is retained for validation.

The fixed matrix contains 60 attempts:

- Express/Markdown: 2 models × 3 prompts × 3 repeats × 2 conditions = 36.
- Express/tool: 2 models × 3 prompts × 1 repeat × 2 conditions = 12.
- JSON/Markdown: the same 12-attempt matrix, as an unchanged-path control.

Both models explicitly use medium thinking. Matched baseline/ordered requests
run together, at concurrency 2, with pair order and within-pair launch order
shuffled using seed 7819. Each attempt has a 120-second timeout. Failures remain
in the denominator. Existing output files are not rerun on resume. JSON condition
labels do not select different implementations: their differences measure
ordinary variability, not the ordering effect. Tool and JSON samples are too
small for a model ranking.

## Reproduce

Install the example's dependencies and configure its ignored `.env.local` as in
the example README. Save the full frontend inputs for both transports as
`inputs.json`, keyed by `markdown` and `tool`, each with `context`, `tools`,
`forwardedProps`, `state`, and `messages`. Use an empty/fresh surface state and
the full standard catalog. Save the three unchanged example suggestions as
`prompts.json`, a list of `{ "name", "prompt" }` objects: `Dashboard on the page`,
`Sign-up with validation`, and `Team plan estimator`.

Freeze the compiler from the bridge-fixed, instrumented baseline:

```bash
git show 41d243228b:examples/v2/a2ui-markdown/agent/src/express.py > /tmp/baseline_express.py
```

From this example's `agent/` directory:

```bash
uv run python benchmarks/parameter_order.py \
  --inputs /tmp/inputs.json --prompts /tmp/prompts.json \
  --baseline /tmp/baseline_express.py --output /tmp/ordering-results
```

The manifest records the complete case list, settings and input/script hashes.
The initial study archived its exact executable as `executed-script.py` before
formatting and lint-only cleanup of the tracked script. Its hash matches the
original manifest; the running process was unaffected. Resuming those results
requires the original script at the same path recorded in the manifest. A
changed script, even with formatting-only changes, requires a new output directory.
Each case retains events, final raw model output, usage metadata, parsed
operations, timing and errors. A successful run or compiled surface alone is
**not** a reliability pass: validate every operation against the frontend
catalog, check root/child references, and evaluate dynamic values. Exercise
representative forms and estimators in the browser separately, labeling those
checks as replay checks when replaying saved live-generated output.

Report counts and denominators, latency distributions, failures and study
limitations. Do not combine these fresh runs with the earlier thinking study:
that older study had a different bridge and a different distribution of thinking
levels. Treat server first-model timing separately from browser visibility.
