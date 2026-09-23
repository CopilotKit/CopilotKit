# LangGraph TypeScript `mcp-apps`: root cause, fix and red/green (2026-09-23)

**Verdict: fixed, and LangGraph TypeScript is now qualified at 40 of 40.** Run b (`lgts-runtime-matrix-20260923b.md`) failed `mcp-apps` with `surface-missing`. That was not a langchain-js bug in reassembling text plus a tool call, and it was not caused by the dependency update. The cause is a stream shape that only the mock produces:

1. The fixture carries a `reasoning` channel.
2. The model is reasoning-capable (`gpt-5-mini` since `bb70c1fd01`), so aimock 1.37.4 replays that reasoning before the `role` delta.
3. `@langchain/openai` (JS) turns a first delta with no role into a generic chunk, and the tool call is lost.

The fix is in the fixture. The old `tool-rendering.ts` workaround was compensating for the same artifact, so it was removed.

| Check                                                     | Result                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| `mcp-apps` before (HEAD `d9c5ff4176`)                     | **RED**, `surface-missing`, both attempts, 67.2 s                 |
| `tool-rendering` with the workaround removed, old fixture | **RED**, no `get_weather` card, both attempts, 45.3 s             |
| `mcp-apps` after                                          | **GREEN**, first attempt, 9.2 s                                   |
| 5 regression cells after                                  | **GREEN**, all first attempt                                      |
| Full strict matrix at `4d5a8802c6`                        | **40/40**, 150.8 s, 134 AIMock requests, 0 strict 503s, 0 retries |

## Root cause

The chain below starts at the fixture and ends at the empty surface. Each link is shown by evidence.

1. **The fixture has a reasoning channel.** The `mcp-apps` probe prompt matches the `create_view` fixture in `d6/langgraph-typescript/tool-rendering-reasoning-chain.json`. That fixture has `reasoning`, `content` and `toolCalls`.
2. **aimock emits that channel only for reasoning-capable models.** Strict aimock's `resolveReasoningForModel` suppresses fixture reasoning for `gpt-4o-mini` and emits it for `gpt-5*`. `bb70c1fd01` (2026-09-16, the model sweep, merged into this branch on 09-23) moved `mcp-apps.ts` from `gpt-4o-mini` to `gpt-5-mini`. The earlier pass on 1.71.1 (`langgraph-typescript-host-d6-esm-webpack.log`, 2026-09-10) ran before that change.
3. **aimock 1.37.4 streams the reasoning before the role.** On `/v1/chat/completions`, `buildContentWithToolCallsChunks` pushes `reasoning_content` deltas first and the `{role: "assistant"}` delta after them. The first SSE event is `delta: {reasoning_content: …}` with no role.
   - Direct aimock repro: for `gpt-5-mini` the first delta is `{"reasoning_content": …}`. For `gpt-4o-mini` it is `{"role": "assistant", "content": ""}`.
4. **`@langchain/openai` 1.5.13 has no default role.** `convertCompletionsDeltaToBaseMessageChunk` computes `role = delta.role ?? defaultRole`, and `defaultRole` starts undefined. The result falls through to `new ChatMessageChunk({content, role, response_metadata})`, whose type is `generic`. That call also drops `additional_kwargs`, so the reasoning text is lost too.
5. **The first chunk decides the aggregated type.** `@langchain/core` 1.2.12 aggregates with `concat(aggregated, chunk)`, starting from the first chunk. `ChatMessageChunk.concat` returns a `ChatMessageChunk`: it merges `additional_kwargs` but drops the `tool_call_chunks` of the later `AIMessageChunk`s. The result is exactly the observed shape: `type: "generic"`, `tool_calls` absent, and the call present only in `additional_kwargs.tool_calls`.
6. **The AG-UI layer finds no tool call.** `@ag-ui/langgraph` maps a `generic` message to an assistant message, but reads only the top-level `tool_calls`. This is true of both 0.0.43 (runtime) and 0.0.42 (`sdk-js`). `MESSAGES_SNAPSHOT` therefore has no `toolCalls`, the MCP Apps middleware has nothing pending, and no `ACTIVITY_SNAPSHOT` is emitted.
7. **Real OpenAI never takes this path.** It puts `role` on the first delta, and Chat Completions never streams reasoning for these models. langchain-python is also immune, because its stream starts from `default_chunk_class = AIMessageChunk` (langchain-openai 1.1.9). This is why the same fixture passes on LangGraph Python.

### Evidence

- **Standalone repro, no stack (`lgts-mcp-apps-repro-20260923.log`, scripts in `lgts-mcp-apps-repro-20260923/`).** It uses aimock 1.37.4's own exported chunk builders and the agent's `@langchain/openai` 1.5.13 and `@langchain/core` 1.2.12, through `streamEvents` (the aggregation path an `invoke` takes inside a LangGraph node).

  | Stream                                        | First delta keys          | End type    | `tool_calls`       |
  | --------------------------------------------- | ------------------------- | ----------- | ------------------ |
  | aimock 1.37.4, content + tool + reasoning     | `reasoning_content`       | **generic** | none (kwargs only) |
  | Same fixture, no reasoning                    | `role, content`           | ai          | `create_view`      |
  | Role on the first delta (aimock 1.43.0 shape) | `role, reasoning_content` | ai          | `create_view`      |
  | aimock tool-only + reasoning                  | `reasoning_content`       | **generic** | none (kwargs only) |

- **Thread state on the stack.** After the RED run (`lgts-mcp-apps-thread-state-red-20260923.log`), the stored assistant message is `type: "generic"`, with `tool_calls` absent and `additional_kwargs.tool_calls: ["create_view"]`. After the GREEN run (`…-green-…`), it is `type: "ai"` with `tool_calls: ["create_view"]`.
- **Run b's direct-run captures** show the same generic message. Run b's diagnostic patch produced a proper `AIMessage`, and the middleware then emitted `TOOL_CALL_RESULT` and `ACTIVITY_SNAPSHOT`. The patch was not committed.

### The hypotheses

- **(a) Duplicate `@langchain/core` copies: no.** `npm ls` shows one `@langchain/core` 1.2.12 and one `@langchain/langgraph` 1.4.17 in each package, the UI and the agent. The failure is a type chosen at construction (`generic`), not an `instanceof` mismatch.
- **(b) The fixture shape against `@langchain/openai` 1.5.13: yes, this is the cause.**
  - The failing fixtures are the only Chat Completions LGTS fixtures that carry `reasoning`: the two `create_view` fixtures and the two "weather in Tokyo" fixtures.
  - `frontend-tools` and the catch-all fixtures carry no `reasoning`, and they work.
  - Content plus a tool call is not the trigger. The full matrix replays 9 Chat Completions fixtures with content and a tool call but no `reasoning`, including `display_flight`, `write_document` ×3 and `render_pie_chart`, and every one of those cells passes. The repro's no-reasoning variant parses as well.
- **(c) `@ag-ui/langgraph` / `sdk-js` serialization: a consequence, not the cause.** Both versions map `generic` to an assistant message but read only `tool_calls`, which LangChain treats as canonical. `handleMessagesTupleEvent` ignores non-`AIMessageChunk` types.
  - Separate observation, not needed for this fix: in `handleSingleEvent`, the chunk carrying the tool name after streamed text takes the `TEXT_MESSAGE_END` branch and `break`s. As a result, no streamed `TOOL_CALL_START` is emitted, even for a proper `AIMessage`; run b's diagnostic-patch SSE has none.
  - MCP Apps and tool rendering still work, because they read `MESSAGES_SNAPSHOT` and `OnToolEnd`. This deserves its own upstream look.
- **(d) Model construction and the workaround's history: the workaround was misdiagnosed.**
  - `makeChatOpenAI` only adds forwarded headers. It does not change the stream.
  - `normalizeAssistantMessage` came from `557f6f7318` (2026-07-28), which fixed the "weather in Tokyo" tool-rendering cell (`gpt-5.4`, with a reasoning fixture). Its commit message and `GOTCHAS.md` blamed langchain-js reassembly of "content plus a tool call" and called it aimock-masked.
  - The truth is the reverse: aimock's replay causes it, and a live stream would not.

## Where the fix lives, and why

- **The fixtures (`f7a1cb4b8e`).** The `reasoning` channel is removed from the four LGTS fixtures replayed over Chat Completions: `create_view` ×2 and "weather in Tokyo" ×2. Each fixture now has a `_comment` explaining why.
  - This is the sanctioned per-integration variation (iron rule 4), and it makes the fixtures faithful. OpenAI Chat Completions never sends that channel for these models.
  - The fixtures now also match LangGraph Python's visible behaviour, because Python drops `reasoning_content` on this endpoint.
  - The Responses API fixtures (`reasoning.json`, the reasoning-chain legs) keep their reasoning. The reasoning-chain cell still replays 6 reasoning fixtures over `/v1/responses` and passes.
- **Workaround removed, not consolidated (`4d5a8802c6`).** `normalizeAssistantMessage` is deleted. A shared helper would have kept code in the backend whose only job is to compensate for a mock (iron rule 3).
  - The discriminating RED proves it was needed only for the fixture's reasoning stream.
  - Knock-on changes:
    - `AIMessage` becomes a type-only import, one line inside the published `weather-tool-backend` region.
    - A shell-docs **test**, not docs content, pinned the old value import. That guard existed only for the normalizer, so it now pins the `SystemMessage` value import that the graph constructs at runtime.
    - The `GOTCHAS.md` diagnosis is corrected.
- **No other LGTS graph used the workaround.** A scan of all fixture directories found that no other fixture reachable by LGTS (`context` `langgraph-typescript` or none) carries `reasoning` on a Chat Completions turn.
- **Upstream.** aimock is the defective component, and its fix is partial: `16646fa255` (in v1.43.0, published 2026-09-22) puts `role` on the first reasoning delta, but only in `buildContentWithToolCallsChunks`. Two gaps remain:
  - Showcase's local runner pins aimock **1.37.4**, which predates even that fix. Production pulls `ghcr.io/copilotkit/aimock:latest`.
  - Bumping the `showcase/scripts` pin is fleet-wide, so it was not done here (one stack only). It is recommended as a follow-up.
- **Nothing was filed.** The issue texts below are drafts for a human to post.

### Draft upstream issue: CopilotKit/aimock

> **Chat Completions: text-only and tool-only streams with `reasoning` still start with a role-less delta**
>
> `16646fa255` ("identify reasoning-first tool streams as assistant") put `role` on the first reasoning delta in `buildContentWithToolCallsChunks`, but `buildTextChunks` and `buildToolCallChunks` in `src/helpers.ts` (v1.43.0 and main) still emit `delta: { reasoning_content }` chunks before the `{ role: "assistant" }` chunk.
>
> Repro: fixture `{ match: { userMessage: "x" }, response: { toolCalls: [{ name: "get_weather", arguments: "{}" }], reasoning: "Think first." } }`, then `POST /v1/chat/completions` `{ model: "o3-mini", stream: true, messages: [{ role: "user", content: "x" }] }`. The first SSE event's `choices[0].delta` is `{ reasoning_content: "…" }` with no `role`. A text-only fixture with `reasoning` behaves the same way.
>
> Impact: `@langchain/openai` (JS, 1.5.13) builds a `ChatMessageChunk` for a role-less first delta. The aggregated message is `generic`, and its tool call exists only in `additional_kwargs.tool_calls`, so LangGraph/`ToolNode`/AG-UI see no tool call. A standalone repro is attached (chunks from aimock's own builders, consumed via `streamEvents`).
>
> Expected: `role` on the first delta, as `16646fa255` does. That means `...(i === 0 && { role: overrides?.role ?? "assistant" })` in both reasoning loops, plus the same test for the text-only and tool-only builders. Also consider: OpenAI models never stream `reasoning_content` on `/v1/chat/completions`, so `resolveReasoningForModel` could also gate on the provider or endpoint, not only on model capability.

### Draft secondary issue: langchain-ai/langchainjs

> **`@langchain/openai`: a streamed Chat Completions delta without `role` becomes `ChatMessageChunk`, and tool calls are lost**
>
> In `convertCompletionsDeltaToBaseMessageChunk`, `role = delta.role ?? defaultRole`, and `_streamResponseChunks` starts with `defaultRole` undefined. A first delta without a role (seen from OpenAI-compatible servers that stream `reasoning_content` first) therefore yields `ChatMessageChunk` and drops `additional_kwargs`. Because concat keeps the first chunk's class, the final message is `generic`: `tool_calls` is empty, and the call is only in `additional_kwargs.tool_calls`.
>
> langchain-openai (Python) starts from `default_chunk_class = AIMessageChunk`, so the same stream parses there. Suggest defaulting to `"assistant"`. The repro and outputs are above.

## LangGraph Python (static check only; its stack was not run)

- **LangGraph Python is likely not affected.**
  - Its `mcp_apps_agent.py` uses `ChatOpenAI(model="gpt-5.4")`, which is Chat Completions and reasoning-capable, and its fixtures carry the same `reasoning` on both `create_view` fixtures. So aimock 1.37.4 sends it the same role-less first delta.
  - But langchain-openai 1.1.9's `_convert_delta_to_message_chunk` returns an `AIMessageChunk` when `role == "assistant"` **or** `default_class == AIMessageChunk`, and the stream starts with `default_chunk_class = AIMessageChunk`. The tool call therefore parses.
  - Python's converter never reads `reasoning_content` on this path, so its fixture reasoning is invisible. That is the parity the LGTS fixture change now matches.

## Red/green and regression runs (strict, one stack)

- **Setup.**
  - aimock was run with the same command and flags as run b (`--strict --validate-on-load`, `AIMOCK_STRICT_TURN_INDEX=1`, no record, proxy or provider flags).
  - The stack was run with the same `npm run dev` command and environment on Node v22.16.0, and the same runner, `run-local-d6.mts --demo <id>`, was used.
  - One stack boot served every run (`lgts-mcp-apps-dev-stack-20260923.log`). aimock was rebooted once, to load the fixed fixtures (`…-aimock-red-…`, `…-aimock-green-…`).
- **Hot reload.** The agent picked up the `tool-rendering.ts` edit through the dev server's own restart (`[tsx] change in ./tool-rendering.ts Restarting...`).
- **Pre-warm.** All 55 routes returned the same status codes as run b (`lgts-mcp-apps-prewarm-20260923.log`).

| Run                                 | State of the tree                                            | Result                                                                                                  | AIMock journal                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mcp-apps` RED                      | HEAD `d9c5ff4176`                                            | red, 67.2 s: `waitForTurnComplete … (reason=surface-missing, runsFinished=1 …)`, after the in-run retry | 2 × `gpt-5-mini`, 200, matched the `create_view` fixture **with** `reasoning`                                          |
| `tool-rendering` discriminating RED | normalizer removed, fixtures at HEAD                         | red, 45.3 s: `expected card for get_weather but selector cascade matched 0 elements`                    | 2 × `gpt-5.4`, 200, matched "weather in Tokyo" / `get_weather` **with** `reasoning`                                    |
| `mcp-apps` GREEN                    | fixtures fixed + normalizer removed; `mcp-apps.ts` unchanged | green, 9.2 s, first attempt                                                                             | 1 × `gpt-5-mini`, 200, the `create_view` fixture without `reasoning`                                                   |
| `tool-rendering`                    | same                                                         | green, 6.5 s                                                                                            | 2 × `gpt-5.4`, 200                                                                                                     |
| `tool-rendering-default-catchall`   | same                                                         | green, 6.5 s                                                                                            | 2 × `gpt-5.4`, 200                                                                                                     |
| `tool-rendering-custom-catchall`    | same                                                         | green, 10.9 s                                                                                           | 4 × `gpt-5.4`, 200                                                                                                     |
| `tool-rendering-reasoning-chain`    | same                                                         | green, 25.3 s                                                                                           | 10 × `/v1/responses` `gpt-5-mini`, 200; 6 fixtures still carry `reasoning`                                             |
| `frontend-tools`                    | same                                                         | green, 17.8 s                                                                                           | 6 × `gpt-5-mini`, 200                                                                                                  |
| Full matrix                         | HEAD `4d5a8802c6`, clean outside `tasks/`                    | **40/40**, 150.8 s, 0 retries, nothing skipped                                                          | 134 requests, all 200, 0 strict 503s; 18 carried `create_view`; 0 Chat Completions responses from `reasoning` fixtures |

Logs and journals: `lgts-mcp-apps-d6-{red,tool-rendering-red,green,full}-20260923.log`, `lgts-mcp-apps-d6-regression-<cell>-20260923.log` and the matching `lgts-mcp-apps-journal-*-20260923.json`. The two quarantined interrupt demos remain policy-excluded and untested, as in run b.

## Static checks

| Check                                                                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict `tsc` on `tool-rendering.ts` and `graph.ts` (run b's flags)                                                            | Both exit 0 (`lgts-mcp-apps-strict-tsc-20260923.log`).                                                                                                                                                                                                                                                                                                                                                                                    |
| `nx run @copilotkit/showcase-scripts:test` on `aimock-fixtures`, `mcp-apps-suggestion-routing` and `aimock-strict-turn-index` | 3 files, **898/898** pass.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Full `showcase-scripts` suite                                                                                                 | 2601/2602 tests pass, and 87 of 89 files. Both failing files are unrelated to this change: `starter-validation-schema` reads the stray `showcase/integrations/.ruff_cache/` (created 11:54 local, before this session, hidden from git by its own `.gitignore`, left in place), and `extract-starter` (which extracts langgraph-python) hit the 30 s timeout under load and passes alone. See `lgts-mcp-apps-fixture-tests-20260923.log`. |
| shell-docs `langgraph-typescript-doc-regions` + `headless-and-tool-region-coverage` (lock-guarded, 1 worker)                  | First run: 15/16. The one failure was the stale guard. After the guard update: **16/16** (`lgts-mcp-apps-doc-regions-20260923.log`).                                                                                                                                                                                                                                                                                                      |
| AIMock `--validate-on-load`                                                                                                   | Loaded 8632 fixtures on both boots, with no errors.                                                                                                                                                                                                                                                                                                                                                                                       |

## Commits

| SHA          | Subject                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `f7a1cb4b8e` | fix(showcase): drop reasoning from LangGraph TypeScript Chat Completions fixtures     |
| `4d5a8802c6` | refactor(showcase): remove the LangGraph TypeScript tool-rendering message normalizer |

This record and its logs are committed after them.

## Resources and cleanup

- **Load and RSS.**
  - Every step ran under `nice -n 10`, with one stack. The 1-minute load, sampled before each run, stayed between 4.3 and 7.5, never near the limit of 16.
  - Audit RSS was sampled every 5 s over the descendants of the aimock, stack and runner processes, including Playwright's Chromium (`lgts-mcp-apps-rss-20260923.log`).
  - The peak was **11.50 GiB** (12,055,808 KiB) in one sample, 22:48:01 during the full matrix: stack 9.08 GiB (`next-server` 7.93 GiB), runner plus Chromium 2.35 GiB, aimock 0.07 GiB. Three samples exceeded 11 GiB. That is below 12 GiB, but 12.3 GB in decimal units. It sums RSS, so shared Chromium pages are counted more than once.
  - The targeted runs peaked at 5.73 GiB.
- **Stopped.** The stack and both aimock boots were stopped with SIGTERM to their own process groups, and the sampler was stopped. No `langgraph-cli`, `langgraph-api`, aimock, `run-local-d6` or runner-owned Chromium process remains.
- **Ports.** 3101, 4410, 8123, 8124 and 2024 are free.
- **Other agents' processes.** None of them was signalled:
  - The docs-compare server on 3910 was in its own process group, and its Chromium was excluded from sampling by ancestry. It was gone by the end, but this session never sent it a signal.
  - The user's :3000 app (pid 91719) is still running.
- **Left in place:** the ignored `src/agent/.langgraph_api/`, which persists threads across boots (older threads there are run b's).

## Limitations

- **Mock replay only.** No live provider was called. The claim that real OpenAI streams `role` first and sends no Chat Completions reasoning for `gpt-5*` rests on the documented stream contract, not on a live capture here.
- **aimock version.** Production's aimock (`:latest`, 1.43.0 or newer) already avoids the content-plus-tool-call case. After the fixture change, LGTS behaves the same on both versions. The text-only and tool-only reasoning builders are still role-less upstream, so a future LGTS Chat Completions fixture with `reasoning` would fail the same way. The `_comment` on each fixture and `GOTCHAS.md` record this.
- **LangGraph Python** was checked statically only.
