# genui-eval

Measures how well models write A2UI with our generative UI prompts, and searches for better prompts.

For each case it builds the client's envelope and markdown context entries, runs the runtime's `GenerativeUIMiddleware` and built-in agent in-process with the model, and mounts the resulting surfaces with the real surface manager and `SurfaceView` in jsdom.

This measures prompt performance on CopilotKit's built-in-agent and React-renderer path. Gemini is called through OpenRouter; Google ADK, `google-genai`, and the A2UI agent SDK's generation, compilation, and recovery paths are not exercised. The renderer does use `@a2ui/web_core`. The checks inspect the initial render; they do not click controls, verify subsequent interactions, or assess screenshots. The judge receives a textual outline. Map and Chart browser dependencies can fail in jsdom, so a passing result is not proof of browser visual quality. Separate integration and browser tests are needed for those claims.

## Quick start

No key is needed to try it: the `offline` preset uses scripted fake models.

```sh
pnpm -s --filter genui-eval eval run --preset offline
pnpm -s --filter genui-eval eval report latest
```

Real models go through [OpenRouter](https://openrouter.ai). Set the key, check the model ids and prices in `eval.config.ts`, and start with a cost estimate:

```sh
echo 'OPENROUTER_API_KEY=sk-or-...' > tools/genui-eval/.env   # git-ignored; wins over the shell
pnpm -s --filter genui-eval eval run --preset smoke --estimate
pnpm -s --filter genui-eval eval run --preset smoke
pnpm -s --filter genui-eval eval run --preset gpt                 # the first baseline: gpt only
pnpm -s --filter genui-eval eval run --preset full --budget 40     # all four models
```

## Backends

A model string picks the backend:

- `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5.5`, …: [OpenRouter](https://openrouter.ai), with `OPENROUTER_API_KEY` (or `tools/genui-eval/.env`).
- `codex:gpt-5.6-luna`, `codex:gpt-6-astra`, …: the local [Codex CLI](https://github.com/openai/codex), signed in with ChatGPT (`codex login`). No key and no per-call cost. `codexConcurrency` in the config (10) or `--codex-concurrency <n>` sets how many calls run at once.
- `fake:<script>`: the offline fake, for tests.

Pass a model string straight to `--models`, and pick the judge and the reasoning effort the same way:

```sh
pnpm -s --filter genui-eval eval run --preset smoke --models codex:gpt-5.6-luna --judge codex:gpt-6-astra --effort medium
```

The harness preserves the built-in agent's production tools and tool choice. Markdown mode omits `render_ui` but still offers the agent's two state tools. OpenRouter and fake backends receive those tools.

The Codex backend is a text-only approximation: it ignores the two state tools and rejects other tools. It makes `codex exec` as close to a plain model call as the CLI allows: the system prompt replaces Codex's own instructions (`model_instructions_file`), it runs in an empty directory with a Codex home that holds only your sign-in (no user config, skills, hooks or AGENTS.md), with no shell, web search or patch tools, in a read-only sandbox, and with a model catalog entry without code mode or multi-agent. About 2.5k tokens of Codex's own request overhead remain. Each call is captured under `results/codex/<date>/`: `instructions.md`, `prompt.md`, `command.json`, `events.jsonl`, `last-message.md` and `stderr.txt`; a sample's `log` field points at its call. The backend supports the markdown transport only. `GENUI_EVAL_CODEX_BIN` picks the binary; by default it is the first `codex` on the PATH that runs. Treat its results as backend-specific, not as an identical production model request.

A run stops, and scores nothing for it, when the provider of the model or of the judge is out of credit or the call is not signed in. A reply cut at the output token cap has its validity left ungraded (the report counts them), and a sample the judge could not grade has judgement and quality ungraded.

`--repair` (an experiment) runs each broken fence line through [jsonrepair](https://github.com/josdejong/jsonrepair) before the client parses it, and keeps the repair only when it is shaped like an A2UI operation. The client itself repairs a complete line that is off by one closing brace; `--repair` also fixes worse breaks. Either repair makes raw validity fail. Each sample records `repairedLines` and `recoveredValidity`; reports show the repair count and validity after recovery separately. Legacy runs used post-repair validity and are labelled accordingly; their validity is not compared with new raw-validity runs.

## How a sample is scored

| Tier      | Question                                                                         | Scored by    |
| --------- | -------------------------------------------------------------------------------- | ------------ |
| validity  | Does the unmodified model output parse, follow A2UI 1.0, and render from a root? | code         |
| fidelity  | No rejected operation, no invalid props, the expected components?                | code         |
| judgement | UI exactly where it helps, no surface that only holds text?                      | code + judge |
| quality   | How good is the UI, measured against the case's reference answer?                | judge        |

Each tier is reported on its own, with a 95% Wilson interval. Every case runs `samples` times per model and transport, because models are not deterministic.

Expected props such as `EntityCard.image` are checked on final reachable instances, with bindings resolved in their template scope. An earlier or unreachable component cannot supply a missing prop. Run records include generation parameters. Baseline reports skip aliases whose model, pinned provider, or parameters changed; legacy records without parameters are flagged and their differences are not marked clear.

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

Every command takes `--json` (for agents) and `--config <file>`, and refuses a flag it does not read. Keep `-s` in `pnpm -s --filter genui-eval eval`: without it pnpm prints the script line on stdout, so `--json` output and `prompt --export-spec > spec.json` are no longer valid JSON.

## Improving the prompt

The prompts are rendered from a **prompt spec** (`GenerativeUIPromptSpec` in `@copilotkit/shared`): the instruction text of both transports, the conditional rule blocks, how the component schema is written, and replacement component and prop descriptions. Without a spec, the builders render the prompts that ship, byte for byte.

- For now the prompt is improved by hand: run, read the failures, change the wording, run again. See `AGENTS.md`.
- `optimize` (a GEPA-style search: reflect on failures, keep candidates that are best on some case, merge, exam on held-out cases) is kept in the code but disabled until the prompt is in good shape.

A winning spec is never written to the repo by the tool. Copy its wording into the builders (`packages/shared/src/generative-ui/prompt-spec.ts`) and the descriptions into the standard catalog, then confirm with a plain `run` that the scores match.

A candidate is accepted only if no model gets worse at validity on the held-out cases, it is clearly better on them (intervals apart), and its guide is at most 10% longer. Between near ties, the shorter prompt wins.

## Files

- `eval.config.ts`: models, presets, judge, reflection model, prices, budget.
- `cases/train.jsonl`: training cases. `cases/heldout.jsonl`: the held-out exam, never used to change the prompt. A case can carry `context`: what the app or its tools would hand the agent (places, a forecast, the product's plans), sent as agent context entries and shown to the judge. Facts the model cannot know from the request belong there, and a case expects a component like `Image` only when its context provides what it needs. An expected entry can require a prop (`EntityCard.image`) or allow alternatives (`Image|EntityCard.image`: a photo either way).
- `fixtures/offline/`: replies of the offline fake model.
- `fixtures/reference/`: one great answer per case (`<id>.markdown.txt`, and the same operations as a tool call in `<id>.tool.txt`). The judge gets it as the bar for quality. `eval run --config reference.config.ts --preset reference` checks that every reference passes the code tiers.
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
The `test / genui-eval` workflow runs the tests and typecheck on relevant pull requests and main pushes without model credentials.
