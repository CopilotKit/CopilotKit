# genui-eval

Measures how well models write A2UI with our generative UI prompts, and searches for better prompts.

It runs the code that ships. For each case it builds what the client sends (the envelope and the markdown context entries), runs the runtime's `GenerativeUIMiddleware` and the built-in agent in-process with the model, and renders the resulting surfaces with the real surface manager and `SurfaceView` in jsdom. Nothing is copied, so a number in a report is a number about the product.

## Quick start

No key is needed to try it: the `offline` preset uses scripted fake models.

```sh
pnpm -s --filter genui-eval eval run --preset offline
pnpm -s --filter genui-eval eval report latest
```

Real models go through [OpenRouter](https://openrouter.ai). Set the key, check the model ids and prices in `eval.config.ts`, and start with a cost estimate:

```sh
export OPENROUTER_API_KEY=sk-or-...
pnpm -s --filter genui-eval eval run --preset smoke --estimate
pnpm -s --filter genui-eval eval run --preset smoke
pnpm -s --filter genui-eval eval run --preset full --budget 20     # the baseline
```

## How a sample is scored

| Tier      | Question                                                          | Scored by    |
| --------- | ----------------------------------------------------------------- | ------------ |
| validity  | Does it parse, follow A2UI 1.0, and render from a root?           | code         |
| fidelity  | No rejected operation, no invalid props, the expected components? | code         |
| judgement | UI exactly where it helps, no surface that only holds text?       | code + judge |
| quality   | Does the UI fit the request?                                      | judge        |

Each tier is reported on its own, with a 95% Wilson interval. Every case runs `samples` times per model and transport, because models are not deterministic.

Before trusting the judge, grade about 20 samples by hand:

```sh
pnpm -s --filter genui-eval eval label latest --n 20     # writes labels/<run>.jsonl
# set "human" to 0 or 1 for judgement and quality in that file
pnpm -s --filter genui-eval eval calibrate labels/<run>.jsonl
```

Aim for at least 80% agreement before relying on the judge's tiers.

## Commands

```
run        [--preset full] [--models a,b] [--cases all|tag:<t>] [--samples n]
           [--transports markdown,tool] [--split both|train|heldout]
           [--budget usd] [--spec file.json] [--estimate]
report     <run|latest> [--base <run>]
failures   <run|latest> [--model id] [--tier ...] [--case id] [--limit n]
prompt     [--transport markdown|tool] [--spec file.json] [--export-spec]
optimize   disabled for now (see below)
label      <run|latest> [--n 20]
calibrate  <labels.jsonl>
```

Every command takes `--json` (for agents) and `--config <file>`. Keep `-s` in `pnpm -s --filter genui-eval eval`: without it pnpm prints the script line on stdout, so `--json` output and `prompt --export-spec > spec.json` are no longer valid JSON.

## Improving the prompt

The prompts are rendered from a **prompt spec** (`GenerativeUIPromptSpec` in `@copilotkit/shared`): the instruction text of both transports, the conditional rule blocks, how the component schema is written, and replacement component and prop descriptions. Without a spec, the builders render the prompts that ship, byte for byte.

- For now the prompt is improved by hand: run, read the failures, change the wording, run again. See `AGENTS.md`.
- `optimize` (a GEPA-style search: reflect on failures, keep candidates that are best on some case, merge, exam on held-out cases) is kept in the code but disabled until the prompt is in good shape.

A winning spec is never written to the repo by the tool. Copy its wording into the builders (`packages/shared/src/generative-ui/prompt-spec.ts`) and the descriptions into the standard catalog, then confirm with a plain `run` that the scores match.

A candidate is accepted only if no model gets worse at validity on the held-out cases, it is clearly better on them (intervals apart), and its guide is at most 10% longer. Between near ties, the shorter prompt wins.

## Files

- `eval.config.ts`: models, presets, judge, reflection model, prices, budget.
- `cases/train.jsonl`: training cases. `cases/heldout.jsonl`: the held-out exam, never used to change the prompt.
- `fixtures/offline/`: replies of the offline fake model.
- `results/` (git-ignored): `run.json` and `samples.jsonl` per run. Query them with DuckDB if the CLI does not answer a question:

  ```sql
  SELECT model, avg(CASE WHEN tiers.validity.pass THEN 1 ELSE 0 END)
  FROM 'results/*/samples.jsonl' GROUP BY model;
  ```

## Tests

```sh
pnpm nx run genui-eval:test
```

The tests run offline: the whole pipeline, the optimizer and every command, with fake models.
