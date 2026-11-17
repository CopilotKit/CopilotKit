# Performance

Measure first paint in the browser (prompt submit to surface mounted), not server-side. The playground's `scripts/batch.mjs` drives real prompts through the chat in headless Chrome and records `firstPaintMs` and `totalMs` per run.

The numbers below were measured on the v0.9 build of the same pipeline (same router, composer and per-component emission). The Gen UI 2.0 port changed the wire format and the renderer, not the pipeline; re-run `batch.mjs` before quoting them.

## Results that set the defaults

|                              | First paint (median) | Total (median) |
| ---------------------------- | -------------------- | -------------- |
| Fixed schema (9 runs)        | 2.0 to 2.6 s         | 2.0 to 2.7 s   |
| Dynamic schema (7 to 8 runs) | 3.2 to 3.8 s         | 6.8 to 9.2 s   |

Ranges are two full suite runs on different days of live-API latency. Dynamic maps add server-side geocoding (up to a few seconds on cold lookups).

Breakdown:

- Router `gpt-5.5`, `reasoning_effort: "none"`, streamed: median 1.25 s to the tool decision.
- Fixed: router + data API. Template-only tools 1.4 to 1.8 s. Live APIs add 0.3 to 4 s and vary.
- Dynamic: composer request start to first token ~1 to 1.5 s, then a component every 100 to 300 ms. Progressive emission puts first paint ~0.2 s after the first token.

## Levers, in order of impact

1. **Progressive emission** (dynamic-schema.md). Without it first paint equals total: 5 to 12 s on the same prompts.
2. **Composer model.** Same ~1.5 KB JSON output, this environment:

   | Model                                  | TTFT  | Total  |
   | -------------------------------------- | ----- | ------ |
   | gpt-5.4-mini, `reasoning_effort: none` | 1.2 s | 4.5 s  |
   | gpt-5.4-nano, `none`                   | 1.1 s | 8.9 s  |
   | gpt-5.5, `none`                        | 2.4 s | 11.8 s |
   | gpt-5.5, `low`                         | 1.8 s | 20.2 s |
   | gpt-4.1-mini                           | 0.7 s | 12.9 s |

   Output tokens per second dominates; pick on total time, not TTFT. Always set `reasoning_effort` to the lowest the model allows for routing and composing.

3. **Fewer components.** "8 to 18 components, show each fact once" cut the Tokyo plan from 23 components (composer 11 s) to 12 components (composer 6.1 s). Encourage one rich component (DataTable, Timeline, ComparisonTable) over many small ones.
4. **Compact catalog prompt.** Build it from the manifest the browser sends (`envelopeToManifest`): one-line signatures (`Name(prop:type, prop?:type): description`), the first sentence of each standard description, and none of the standard components' styling props. For the v0.9 catalog of 73 components that was ~3.4k tokens against several times that for full JSON Schema. Cache it per catalog id so the system prompt stays byte-identical and OpenAI prompt caching applies.
5. **Cache data APIs** in memory (15 min TTL). Repeat demos paint fixed surfaces in ~1.5 s.
6. **Skip hops.** Run data tools in parallel; when the router fetched data without calling `generate_a2ui`, compose in the same run.
7. **Fixed templates for frequent asks.** Every ask you move from dynamic to fixed saves 3 to 8 s to completion and removes layout variance.

## What made the earlier 20-component catalog slow

The previous build (`agent-design-system`) ran a LangGraph Python agent on a separate server, with `gpt-5.5` at its default reasoning effort writing the full component list as tool arguments, and the surface painted only after that call finished. Reasoning effort, no progressive emission and the extra server hop each cost seconds; the levers above address all three.
