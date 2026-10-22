# Parameter-order comparison: 60 live API-key requests

Run on October 21 PDT / October 22 UTC, 2026. Matched pairs at medium thinking, concurrency 2, fresh sessions. Counts below retain all attempts. These are exploratory results, not a model ranking.

## Findings for the PR

Ordering 52 of the 69 standard component signatures by purpose improved the main Express/Markdown sample from **10/18 to 14/18** strict schema/graph passes, and from **9/18 (50%) to 13/18 (72%)** after evaluating initial expressions. Five matched pairs improved and one regressed on the latter criterion. This is an encouraging small-sample signal, not an established reliability rate or a full interaction pass.

Browser scenario checks on saved live-generated output were stricter: **5/18 baseline versus 8/18 ordered** passed the combined generation, validation and browser checks. Sign-up validation and calculator expressions remain problems. The ordering change fixes a deterministic positional-argument mismatch; it does not make the demo reliably satisfy every prompt.

Median total Express/Markdown duration was **16.94 → 12.09 seconds on 3.6**, and **31.26 → 31.22 seconds on 3.8**, across all attempts. These include failures, and cache/provider variability was uncontrolled. There is no demonstrated general latency win.

In 12 live JSON/Markdown control runs, first model output reached AG-UI text in a median **0.321 ms**, maximum **0.530 ms** at the benchmark callback boundary. Two supplementary live browser runs also forwarded the first SDK text in under 1 ms. Their long initial silence occurred before the first model text, not while the adapter waited for a complete valid UI.

Baseline: `41d243228b`; ordering implementation and harness: `f440d24ff7`. The change is confined to the demo's combined Python Express catalog; JSON generation and React components are unchanged. The separate Carousel/FollowUp description PR is not included in either arm.

[Per-attempt measurements](ordering-runs.csv) accompany this report. [Reproduction and study design](README.md) describe the fixed matrix. Raw events, generated output, input catalogs, scripts, screenshots, dependency versions and source hashes are retained in `adk-parameter-order-study-2026-10-21.tar.gz` (local evidence bundle, not committed).

## Reliability

| Format / transport / model            | Condition | Compiled | Strict schema + graph | + Initial expressions |
| ------------------------------------- | --------- | -------: | --------------------: | --------------------: |
| express / markdown / gemini-3.6-flash | baseline  |      5/9 |                   5/9 |                   4/9 |
| express / markdown / gemini-3.6-flash | ordered   |      6/9 |                   6/9 |                   5/9 |
| express / markdown / gemini-3.8-flash | baseline  |      5/9 |                   5/9 |                   5/9 |
| express / markdown / gemini-3.8-flash | ordered   |      8/9 |                   8/9 |                   8/9 |
| express / tool / gemini-3.6-flash     | baseline  |      2/3 |                   2/3 |                   2/3 |
| express / tool / gemini-3.6-flash     | ordered   |      3/3 |                   3/3 |                   3/3 |
| express / tool / gemini-3.8-flash     | baseline  |      3/3 |                   3/3 |                   3/3 |
| express / tool / gemini-3.8-flash     | ordered   |      3/3 |                   3/3 |                   3/3 |
| json / markdown / gemini-3.6-flash    | baseline  |      3/3 |                   2/3 |                   2/3 |
| json / markdown / gemini-3.6-flash    | ordered   |      3/3 |                   3/3 |                   3/3 |
| json / markdown / gemini-3.8-flash    | baseline  |      3/3 |                   3/3 |                   2/3 |
| json / markdown / gemini-3.8-flash    | ordered   |      3/3 |                   2/3 |                   1/3 |

Compiled means a finished run with at least one create and no generation/bridge errors. Strict success additionally requires every emitted operation to validate and the final root graph to resolve without missing children/cycles. Expression success evaluates initial final-state values; it does not prove visual quality, requested behavior, or action correctness.

## Paired outcomes

The pass criterion here includes initial expressions.

| Format / transport | Both pass | Baseline only | Ordered only | Both fail |
| ------------------ | --------: | ------------: | -----------: | --------: |
| express/markdown   |         8 |             1 |            5 |         4 |
| express/tool       |         5 |             0 |            1 |         0 |
| json/markdown      |         3 |             1 |            1 |         1 |

Pairing is by model, prompt and repeat. JSON uses identical implementations in both conditions; differences are stochastic control variability.

JSON/Markdown forwarded first model output to AG-UI text within **0.53ms in all 12 attempts** (median 0.321ms). That measured initial silence was upstream of the JSON adapter. Express median gap was 0.312ms, with one 2.357s wait before first converted text.

## Latency (all attempts)

Each cell is median / nearest-rank p90 seconds. Parsed UI is an event-parser milestone, **not browser visibility**. Missing milestones are excluded from their distribution; total duration includes failed attempts.

| Format / transport / model / condition     |  First model output |    First AG-UI text |   Model→AG-UI gap |     Parsed first UI |               Total |
| ------------------------------------------ | ------------------: | ------------------: | ----------------: | ------------------: | ------------------: |
| express/markdown/gemini-3.6-flash/baseline | 14.67 / 23.95 (n=9) | 14.67 / 23.95 (n=9) | 0.00 / 0.01 (n=9) | 15.29 / 18.83 (n=5) | 16.94 / 28.60 (n=9) |
| express/markdown/gemini-3.6-flash/ordered  |  9.68 / 23.29 (n=9) |  9.68 / 23.29 (n=9) | 0.00 / 0.00 (n=9) | 11.88 / 20.50 (n=6) | 12.09 / 26.48 (n=9) |
| express/markdown/gemini-3.8-flash/baseline | 25.58 / 40.25 (n=9) | 25.58 / 40.25 (n=9) | 0.00 / 0.00 (n=9) | 28.49 / 43.41 (n=5) | 31.26 / 43.89 (n=9) |
| express/markdown/gemini-3.8-flash/ordered  | 26.98 / 44.83 (n=9) | 29.34 / 44.83 (n=9) | 0.00 / 2.36 (n=9) | 26.92 / 49.06 (n=8) | 31.22 / 50.05 (n=9) |
| express/tool/gemini-3.6-flash/baseline     | 17.88 / 32.32 (n=3) |                   — |                 — | 16.13 / 17.95 (n=2) | 17.95 / 32.33 (n=3) |
| express/tool/gemini-3.6-flash/ordered      | 12.98 / 31.38 (n=3) |                   — |                 — | 13.05 / 31.51 (n=3) | 13.05 / 31.51 (n=3) |
| express/tool/gemini-3.8-flash/baseline     | 54.70 / 57.66 (n=3) |                   — |                 — | 54.83 / 57.71 (n=3) | 54.83 / 57.71 (n=3) |
| express/tool/gemini-3.8-flash/ordered      | 34.04 / 37.51 (n=3) |                   — |                 — | 34.09 / 37.60 (n=3) | 34.09 / 37.61 (n=3) |
| json/markdown/gemini-3.6-flash/baseline    | 14.27 / 18.23 (n=3) | 14.27 / 18.23 (n=3) | 0.00 / 0.00 (n=3) | 14.51 / 18.53 (n=3) | 18.43 / 23.26 (n=3) |
| json/markdown/gemini-3.6-flash/ordered     | 19.23 / 22.23 (n=3) | 19.23 / 22.23 (n=3) | 0.00 / 0.00 (n=3) | 19.43 / 22.41 (n=3) | 23.60 / 27.69 (n=3) |
| json/markdown/gemini-3.8-flash/baseline    | 22.82 / 24.90 (n=3) | 22.82 / 24.90 (n=3) | 0.00 / 0.00 (n=3) | 23.13 / 25.08 (n=3) | 31.27 / 31.73 (n=3) |
| json/markdown/gemini-3.8-flash/ordered     | 14.95 / 38.82 (n=3) | 14.95 / 38.82 (n=3) | 0.00 / 0.00 (n=3) | 15.06 / 39.30 (n=3) | 21.17 / 47.28 (n=3) |

## Latency (initial-expression-valid attempts only)

Survivor-only descriptive measurements; these exclude failed attempts and must not substitute for all-attempt latency or reliability.

| Format / transport / model / condition     |  First model output |    First AG-UI text |   Model→AG-UI gap |     Parsed first UI |               Total |
| ------------------------------------------ | ------------------: | ------------------: | ----------------: | ------------------: | ------------------: |
| express/markdown/gemini-3.6-flash/baseline | 12.08 / 14.67 (n=4) | 12.08 / 14.67 (n=4) | 0.00 / 0.00 (n=4) | 14.69 / 16.46 (n=4) | 15.05 / 16.94 (n=4) |
| express/markdown/gemini-3.6-flash/ordered  |  9.52 / 10.17 (n=5) |  9.52 / 10.17 (n=5) | 0.00 / 0.00 (n=5) | 11.76 / 12.26 (n=5) | 11.76 / 12.27 (n=5) |
| express/markdown/gemini-3.8-flash/baseline | 25.58 / 40.25 (n=5) | 25.58 / 40.25 (n=5) | 0.00 / 0.00 (n=5) | 28.49 / 43.41 (n=5) | 29.15 / 43.89 (n=5) |
| express/markdown/gemini-3.8-flash/ordered  | 24.71 / 44.83 (n=8) | 25.89 / 44.83 (n=8) | 0.00 / 2.36 (n=8) | 26.92 / 49.06 (n=8) | 31.02 / 50.05 (n=8) |
| express/tool/gemini-3.6-flash/baseline     | 16.08 / 17.88 (n=2) |                   — |                 — | 16.13 / 17.95 (n=2) | 16.13 / 17.95 (n=2) |
| express/tool/gemini-3.6-flash/ordered      | 12.98 / 31.38 (n=3) |                   — |                 — | 13.05 / 31.51 (n=3) | 13.05 / 31.51 (n=3) |
| express/tool/gemini-3.8-flash/baseline     | 54.70 / 57.66 (n=3) |                   — |                 — | 54.83 / 57.71 (n=3) | 54.83 / 57.71 (n=3) |
| express/tool/gemini-3.8-flash/ordered      | 34.04 / 37.51 (n=3) |                   — |                 — | 34.09 / 37.60 (n=3) | 34.09 / 37.61 (n=3) |
| json/markdown/gemini-3.6-flash/baseline    | 13.86 / 14.27 (n=2) | 13.86 / 14.27 (n=2) | 0.00 / 0.00 (n=2) | 14.10 / 14.51 (n=2) | 17.20 / 18.43 (n=2) |
| json/markdown/gemini-3.6-flash/ordered     | 19.23 / 22.23 (n=3) | 19.23 / 22.23 (n=3) | 0.00 / 0.00 (n=3) | 19.43 / 22.41 (n=3) | 23.60 / 27.69 (n=3) |
| json/markdown/gemini-3.8-flash/baseline    | 21.73 / 24.90 (n=2) | 21.73 / 24.90 (n=2) | 0.00 / 0.00 (n=2) | 22.08 / 25.08 (n=2) | 26.69 / 31.27 (n=2) |
| json/markdown/gemini-3.8-flash/ordered     | 14.95 / 14.95 (n=1) | 14.95 / 14.95 (n=1) | 0.00 / 0.00 (n=1) | 15.06 / 15.06 (n=1) | 21.17 / 21.17 (n=1) |

## Usage tokens

Each cell is median / p90 (observed metadata count). Missing cached metadata is not inferred as zero.

| Format / transport / model / condition     |                    Prompt |                    Cached |                Thoughts |               Candidate |
| ------------------------------------------ | ------------------------: | ------------------------: | ----------------------: | ----------------------: |
| express/markdown/gemini-3.6-flash/baseline | 17527.00 / 17577.00 (n=9) | 15466.00 / 15481.00 (n=3) | 2606.00 / 5017.00 (n=9) |  831.00 / 1966.00 (n=9) |
| express/markdown/gemini-3.6-flash/ordered  | 17526.00 / 17576.00 (n=9) | 15465.00 / 15480.00 (n=4) | 2046.00 / 5149.00 (n=9) |  766.00 / 1094.00 (n=9) |
| express/markdown/gemini-3.8-flash/baseline | 17527.00 / 17577.00 (n=9) | 15473.50 / 15481.00 (n=4) | 3339.00 / 5616.00 (n=9) | 1001.00 / 1489.00 (n=9) |
| express/markdown/gemini-3.8-flash/ordered  | 17526.00 / 17576.00 (n=9) | 15460.00 / 15525.00 (n=7) | 3378.00 / 5591.00 (n=9) | 1066.00 / 1511.00 (n=9) |
| express/tool/gemini-3.6-flash/baseline     | 17581.00 / 17631.00 (n=3) | 15527.50 / 15535.00 (n=2) | 3155.00 / 6029.00 (n=3) |  894.00 / 1223.00 (n=3) |
| express/tool/gemini-3.6-flash/ordered      | 17580.00 / 17630.00 (n=3) | 15519.00 / 15519.00 (n=2) | 2408.00 / 5332.00 (n=3) |  702.00 / 1661.00 (n=3) |
| express/tool/gemini-3.8-flash/baseline     | 17581.00 / 17631.00 (n=3) | 11844.00 / 15515.00 (n=2) | 6324.00 / 7734.00 (n=3) |  909.00 / 1503.00 (n=3) |
| express/tool/gemini-3.8-flash/ordered      | 17580.00 / 17630.00 (n=3) | 11843.50 / 15514.00 (n=2) | 4178.00 / 4350.00 (n=3) |  890.00 / 1295.00 (n=3) |
| json/markdown/gemini-3.6-flash/baseline    | 13861.00 / 13911.00 (n=3) |                         — | 2971.00 / 3821.00 (n=3) | 1191.00 / 1248.00 (n=3) |
| json/markdown/gemini-3.6-flash/ordered     | 13861.00 / 13911.00 (n=3) |                         — | 4182.00 / 4485.00 (n=3) | 1178.00 / 1365.00 (n=3) |
| json/markdown/gemini-3.8-flash/baseline    | 13861.00 / 13911.00 (n=3) |                         — | 2702.00 / 3515.00 (n=3) | 1168.00 / 1417.00 (n=3) |
| json/markdown/gemini-3.8-flash/ordered     | 13861.00 / 13911.00 (n=3) |                         — | 2025.00 / 5591.00 (n=3) | 1096.00 / 1436.00 (n=3) |

The evidence bundle’s `stats.json` includes the detailed machine-readable distributions, model-specific paired outcomes, and every failed attempt.

## Failure categories across all attempts

- Title missing required text: **3** (`gemini-3.6-flash-express-markdown-0-1-baseline`).
- Duplicate Row align argument: **1** (`gemini-3.6-flash-express-markdown-3-1-baseline`).
- Invalid nested calc/series data expression: **2** (`gemini-3.6-flash-express-markdown-3-1-ordered`).
- series arguments compiled as string rather than object: **6** (`gemini-3.6-flash-express-markdown-3-2-baseline`).
- No valid create before surface updates: **2** (`gemini-3.6-flash-express-markdown-5-1-ordered`).
- Column children positional value bound to align: **1** (`gemini-3.6-flash-express-tool-3-1-baseline`).
- JSON event wrapper/prop shape: **2** (`gemini-3.6-flash-json-markdown-3-1-baseline`).
- Unsupported ternary in formatString interpolation: **2** (`gemini-3.8-flash-json-markdown-3-1-baseline`).

## Failure examples

- **generation_or_bridge: 13 attempts.**
  - `gemini-3.6-flash-express-markdown-0-1-baseline`: ["ValueError: Invalid A2UI Express: Component 'Title' missing required property 'text'. - Help: Please correct the syntax error in your Express DSL."]
  - `gemini-3.6-flash-express-markdown-3-1-baseline`: ["ValueError: Invalid A2UI Express: Property 'align' of component 'Row' was provided multiple times. - Help: Remove duplicate specification of property 'align' for component 'Row'."]
  - `gemini-3.6-flash-express-markdown-3-2-baseline`: ["ValueError: Invalid A2UI Express: components.chartSection.data: {'@call': 'series', 'args': 'i'} is not valid under any of the given schemas\ncomponents.chartSection.data: Function arguments for 'series' must be an object/dictionary"]
- **strict_schema: 2 attempts.**
  - `gemini-3.6-flash-json-markdown-3-1-baseline`: ['component "quote-form": unknown prop "events"']
  - `gemini-3.8-flash-json-markdown-5-1-ordered`: ['component "submit-button": unknown prop "event"']
- **graph: 0 attempts.**
- **initial_expression: 4 attempts.**
  - `gemini-3.6-flash-express-markdown-3-1-ordered`: ['calc: the left side of * is not a number']
  - `gemini-3.6-flash-express-markdown-3-3-baseline`: ['calc: unknown name i; pass it as an arg in "i * seats * 29 * (annual ? 0.8 : 1)"']
  - `gemini-3.8-flash-json-markdown-3-1-baseline`: ['formatString: unexpected "? \'Annual billing (20% off)\' : \'Billed monthly\'" in ${/annual ? \'Annual billing (20% off)\' : \'Billed monthly\'}']

## Limits

Only three prompts, nine Express/Markdown attempts per model/condition, and three tool/JSON attempts per model/condition. Timeouts are 120 seconds; none of the 60 attempts timed out. No automatic frontend repair turns. Implicit prompt-cache warming and provider load were uncontrolled; absent cached-token metadata is reported as missing, not zero. The paired requests share concurrency conditions; no claim separates provider load from model behavior. The evaluator uses the real renderer data model and expression resolver but does not mount React components; browser replay results must be reported separately. Counts are strict across the operation stream, rather than accepting a later repair after rejection.

The executed script, input prompts/catalog, baseline compiler and manifest are archived. Formatting/lint-only changes make the tracked harness hash differ from the execution copy. Additional source snapshots and hashes capture the ordered policy and dependency lockfile; the original manifest alone does not cover all runtime source.

## Browser scenario checks (replay, no new model generations)

All 24 primary Express/Markdown outputs that passed strict schema/graph checks were replayed in the real demo with Playwright/Chromium. Failed upstream attempts remain in the denominator of 18 per condition. The checks below are specific scenarios, not exhaustive acceptance tests or latency measurements.

| Prompt                        | Baseline |  Ordered |
| ----------------------------- | -------: | -------: |
| Dashboard                     |      4/6 |      6/6 |
| Sign-up                       |      1/6 |      0/6 |
| Team estimator                |      0/6 |      2/6 |
| Combined pipeline + scenarios | **5/18** | **8/18** |

The dashboard checks require the dashboard target, three stat labels, a chart figure, a table and no renderer error. Sign-up checks cover initial and invalid-input disabling, valid fields with terms unchecked, enabling after terms are checked, and a submitted event carrying the entered name/email. Estimator checks set seven seats, verify $203.00 monthly and $162.40 with annual discount, verify the chart's final 12-month value changes from $2,436 to approximately $1,948.80, and exercise quote-form validation/submission. The harness intercepts submission responses, so no further model calls occur. Chart accessible values are checked; pixel quality and every chart row are not exhaustively assessed.

Nine of ten strictly valid sign-up outputs failed at least one browser scenario. All nine enabled submission with terms unchecked. Generated `required(value=terms)` treats boolean false as nonempty in the current renderer (`functions.ts`, `BASIC_FUNCTIONS.required`). A boolean condition bound directly to the terms value is needed to require consent. One ordered output also enabled submission with initially empty/invalid fields. These are model/guidance or desired-validator-semantics issues, not evidence of an ordering or Google SDK defect. No production workaround or patch was added for them during the study.

Two of four strictly valid estimator outputs failed initial chart expressions, confirmed by visible renderer errors. The two passing estimators were generated by ordered 3.8; both changed price and cumulative chart values without another model request.

## Supplementary live browser timing (two additional requests)

Fresh JSON/Markdown dashboard requests ran sequentially after the paired study, one per model with the demo's default configuration (no explicit thinking override). These are separate observations, not part of the 60-attempt comparison or a model ranking. Both rendered without error panels.

| Model            | ADK model entry → first text | SDK text → AG-UI text | Browser first text | Browser first UI visibility proxy | Browser completion | Text chunks |
| ---------------- | ---------------------------: | --------------------: | -----------------: | --------------------------------: | -----------------: | ----------: |
| gemini-3.6-flash |                     19.692 s |              0.715 ms |           19.904 s |                          21.117 s |           24.065 s |          49 |
| gemini-3.8-flash |                     11.817 s |              0.417 ms |           11.853 s |                          13.793 s |           18.518 s |          45 |

The model-entry timestamp precedes SDK preprocessing and network dispatch. Browser columns are elapsed from the browser run start; server and browser clocks are not subtracted across processes. The visibility proxy checks nonempty visible surface content after two animation frames, not compositor telemetry. Browser text-to-visibility gaps were 1.213 s and 1.940 s. Text arrived over 4.103 s and 6.622 s respectively, rather than as one buffered completed response. The pre-text wait includes provider/model processing; these measurements cannot isolate thinking time from other API latency.

## Versions and provenance

Installed Python versions: `google-adk 2.12.0`, `google-genai 2.32.0`, `ag-ui-adk 0.11.0`, `ag-ui-protocol 1.0.0`, `a2ui-agent-sdk 0.9.0`, `a2ui-core 0.4.0`. Browser checks used Playwright 1.59.1 and the running Next.js development demo.

The artifact contains the exact executed harness, both generated guides (61,579 characters each), all 69 before/after signatures, and the full input catalogs. Ordered source snapshots are from the final formatting/lint-only revision; those cleanups did not alter ordering semantics or the running study process. The harness is benchmark-only factory injection, not a production or Google SDK patch.
