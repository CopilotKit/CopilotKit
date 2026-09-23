# LangGraph TypeScript: qualification rerun on published CopilotKit 1.73.3 (2026-09-23, run b)

**Verdict: still not qualified, 39 of 40.** The raw strict matrix passed 39 of 40 checks, the same count as run a (`lgts-runtime-matrix-20260923.md`). The published-catalog count is also 39 of 40. The one failure is still `mcp-apps`, but the cause has changed:

- **Fixed.** Tool discovery now works. The canonical `/mcp` endpoint removed every redirect error, and the model request now carries `create_view`.
- **Newly exposed.** The LangGraph TypeScript `mcp_apps` graph drops the model's tool call, so the MCP Apps middleware has nothing to execute. See [Remaining defects](#remaining-defects).

Every other defect from run a is fixed and verified:

- The documented setup boots.
- `/api/smoke` fails on run errors.
- REPAIR-035: `shared-state-read` now reads the recipe. Red/green is shown below.
- REPAIR-038: the published regions are public.

The two quarantined interrupt demos remain **policy-excluded and untested**.

|                       | Run a (`lgts-runtime-matrix-20260923.md`)                                                 | Run b (this record)                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Raw matrix            | 39/40, fail `mcp-apps`                                                                    | **39/40**, fail `mcp-apps`                                                                       |
| Published catalog     | 39/40                                                                                     | **39/40**                                                                                        |
| `mcp-apps` cause      | discovery `fetch failed { cause: unexpected redirect }` (17×), `tools=[]`, 26 strict 503s | discovery OK, 0 strict 503s, tool call lost in the agent's stream reassembly (`surface-missing`) |
| `shared-state-read`   | green, but not discriminating (fixture ignored the recipe)                                | green, and discriminating (red on the old routing)                                               |
| Documented setup boot | FAIL (`Cannot find module 'pdf-parse'`)                                                   | **PASS**: 8123 bound in 3 s, 29/29 graphs return 200                                             |
| `/api/smoke`          | 200 `ok` on a `RUN_ERROR` stream                                                          | 200 only on `RUN_FINISHED`; 502 `run_error` otherwise                                            |

## Provenance

- **Worktree:** `tyler/docs-feature-audit`. The matrix and static checks ran at HEAD `0c7796721b`, and the working tree matched HEAD outside `tasks/`. All commits are pushed.
- **Concurrent work:** another agent committed under `packages/` during the run (`d9a155995f`, `a4e9126d08`). The integration consumes only registry-published packages, so those commits do not affect it.
- **Toolchain:** the stack, matrix, builds and setup reproduction ran on Node v22.16.0 / npm 10.9.2. The agent lock was generated, and `npm ci` run, with Node v24.11.0 / npm 11.6.1, then validated with npm 10.9.2 (as in run a).
- **Resources:**
  - Every heavy step ran under `nice -n 10`, with one stack at a time.
  - The 1-minute load stayed below 7.
  - Peak sampled audit RSS was **10.29 GB**: AIMock, stack and runner together, with `next-server` at 8.70 GB (`lgts-rss-matrix-20260923b.log`).
  - The later guard test peaked at about 4.4 GB (main process) with nothing else running.
- **vitest workers:**
  - Harness (vitest 3.2.4): `--poolOptions.forks.execArgv` must be passed twice so it becomes an array. A single string is spread into characters (`node - - m a x …`), and the worker hung reading stdin. That first attempt was killed.
  - shell-docs (vitest 4.1.7): `poolOptions` no longer exists there, so `--execArgv=--max-old-space-size=4096` was used. `ps` confirmed the worker received the flag.

## Part A: the pending set was not only the dependency update

Of the 16 uncommitted LangGraph TypeScript files, only 4 were the dependency update. These were committed as `4fcee0bb4b`: `package.json`, `package-lock.json`, `src/agent/package.json` and `src/agent/package-lock.json`.

The other 12 are the LangGraph TypeScript halves of the September 23 family doc fixes, which were held back while run a had the integration locked:

- **The halves of `c3de380c93` and `0edbee75f6`:**
  - `@region` markers in `a2ui-fixed.ts`, `recovery-agent.ts`, `tool-rendering.ts`, `tool-rendering-reasoning-chain.ts` and the two A2UI routes;
  - the reasoning-chain page region;
  - a corrected reasoning-model comment;
  - the `a2ui-fixed-schema` manifest highlight moved to its dedicated route;
  - three untracked setup pages (`docs/setup/{tool-rendering,a2ui-fixed-schema,a2ui-recovery}-setup.mdx`).

  Item 3 is defined on these regions, so they were committed separately first as `6484ca2c01`. They carried a known leak, which `5fee65149d` then fixed. The repo's pre-commit `lint-fix` also rewrote some imports in two of these files as type-only imports.

- **`src/app/demos/shared-state-read/page.tsx`** was an uncommitted sync of the canonical page (the `shared-state-read-publish` region). It landed with item 4's sync.

## Commits

| SHA          | Subject                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `4fcee0bb4b` | chore(showcase): update LangGraph TypeScript to current stable dependencies                                             |
| `8cec916e5e` | fix(showcase): use canonical Excalidraw MCP endpoint                                                                    |
| `0e3fc47f23` | fix(showcase): declare pdf-parse for the LangGraph TypeScript agent                                                     |
| `6484ca2c01` | docs(showcase): source LangGraph TypeScript tool-rendering and A2UI setup (pending family-fix halves)                   |
| `5fee65149d` | fix(showcase): keep LangGraph TypeScript published regions public                                                       |
| `4b7aacc6cf` | docs(langgraph): update the Zod note for sdk-js 1.73.3                                                                  |
| `7e2b368bc5` | fix(showcase): make LangGraph TypeScript smoke route fail on run errors                                                 |
| `71f6525af9` | fix(showcase): read the shared-state-read title without an evaluate argument (shared probe defect found by the red run) |
| `0c7796721b` | fix(showcase): make LangGraph TypeScript shared-state-read agent read the recipe                                        |
| `4147a5c04f` | docs(audit): replace the LangGraph TypeScript setup reproduction with the boot variant                                  |

### What each fix changed

1. **Excalidraw endpoint (`8cec916e5e`).**
   - `curl -sI https://mcp.excalidraw.com` returns `308`, `location: /mcp`. `curl -sI https://mcp.excalidraw.com/mcp` returns `405` with no `Location` header.
   - The default was changed in all **32** MCP Apps and Beautiful Chat routes across the Showcase. The same change covers the page and e2e comments, QA notes, READMEs, `.env.example`, the harness comments and fixture comment, and both docs snippets: 87 files, 91 lines, URL-only.
   - Every route pins `serverId`, so persisted MCP Apps still restore.
2. **pdf-parse (`0e3fc47f23`).**
   - Added `pdf-parse` `1.1.4` and `@types/pdf-parse` `1.1.5` to the agent.
   - The lock was regenerated fresh with `npm install --package-lock-only --before=2026-09-22T21:49:00Z`, the same bound as run a (`lgts-agent-pdfparse-lock-20260923b.log`). Against the committed lock, the diff is only three **added** entries: `pdf-parse` 1.1.4, `node-ensure` 0.0.0 and `@types/pdf-parse` 1.1.5. Nothing changed or was removed, and the `inBundle` entries survive.
   - Publish ages: 7894 h, 101409 h and 12955 h. All three resolve from `registry.npmjs.org`.
   - `npm ci` added 300 packages. `npm ci --dry-run`, with and without `--legacy-peer-deps`, passes on npm 10.9.2 (`lgts-agent-pdfparse-npm-ci-20260923b.log`).
   - `multimodal.ts` passes the strict typecheck.
3. **Public regions (`5fee65149d`, REPAIR-038).**
   - `gen-ui-agent.ts` now has **one contiguous** `gen-ui-agent-wiring` region. It holds a public `graph` built on `new ChatOpenAI({ temperature: 0, model: "gpt-5-mini" })`, and `showcaseGraph` (using `makeChatOpenAI`) sits outside the region.
   - The recursion limit moved to `.withConfig({ recursionLimit: 50 })`. `compile()` had silently ignored the old `recursionLimit` option, which was also a strict type error inside the published snippet.
   - `tool-rendering-reasoning-chain.ts` gets the same public/showcase split. The root tool-rendering guide shows its `reasoning-chain-model` region, which published `makeChatOpenAI`.
   - `tool-rendering-bind-tools` now starts after the `makeChatOpenAI` line, and the setup page names the tools and tells readers to build `ChatOpenAI`.
   - `langgraph.json` **and the production `server.mjs`** load `showcaseGraph`. `server.mjs` had kept `agent_config_agent`, `frontend_tools` and `subagents` on their public graphs since `2238c9d56d`, which is on `origin/main`. Production therefore ran those graphs without header forwarding. It now matches `langgraph.json`.
   - The doc-regions test now:
     - dedupes region names;
     - joins a multi-part region's parts with a blank line, as `bundle-demo-content.ts` does for `<Snippet>`;
     - asserts every setup `<DemoCode>` region is single-part;
     - covers the gen-ui-agent, tool-rendering, reasoning-chain and A2UI regions;
     - adds `tool-rendering-setup`, `a2ui-fixed-schema-setup` and `a2ui-recovery-setup` to the public-only setup check;
     - checks that `server.mjs` loads every `showcaseGraph` that `langgraph.json` does.
   - **Red:** the extended test fails 4 of 13 against the pre-fix agent files (temporary local revert, not committed; `lgts-doc-regions-red-item3-20260923b.log`). **Green:** 13/13.
4. **shared-state-read (`0c7796721b`, REPAIR-035).**
   - New `src/agent/shared-state-read.ts`. Its state is `{...CopilotKitStateAnnotation.spec, recipe: Annotation<Record<string, unknown>>}`, and the chat node puts a `SystemMessage` built from `state.recipe` ahead of the conversation.
   - The code sits in a `shared-state-read-agent` region with a public/showcase split. It is registered as `shared_state_read: ./shared-state-read.ts:showcaseGraph` in both `langgraph.json` and `server.mjs`.
   - The route takes `shared-state-read` out of `starterAgentNames` and adds `agents["shared-state-read"] = createAgent("shared_state_read")`.
   - Also changed:
     - the manifest highlight and description;
     - the fixture, now gated on `systemMessage: "Lemon Saffron Orzo"` for both turns (as the LangGraph Python and ADK fixtures have been since `d9467aa407`);
     - the guide's LangGraph TypeScript block, now in LangGraph Python's form with its own region;
     - the canonical page header, synced with `--write`; check mode is clean.
   - **Model choice:** the graph uses `gpt-4o-mini`. `@langchain/openai` sends system messages to any `gpt-5*` model as `developer` messages over Chat Completions (verified by capturing request bodies). AIMock 1.37.4's `systemMessage` matcher reads only `role: "system"` on that endpoint, so a `gpt-5` agent can never satisfy the gate. See Remaining defects.
5. **Smoke (`7e2b368bc5`).** The route now sends `randomUUID()` thread, run and message ids and reads the AG-UI stream to its terminal event (`lgts-smoke-route-20260923b.log`):
   - The old thread id, posted directly, streams `RUN_ERROR` ("Failed to create thread: HTTP 400 … Invalid uuid").
   - The fixed route returns 200 `ok` in about 1 s.
   - With the old thread id temporarily restored (not committed), the route returns **502 `run_error`**.
6. **Zod note (`4b7aacc6cf`).** Checked against the registry (`lgts-zod-note-verify-20260923b.log`):
   - `@copilotkit/sdk-js@1.73.3` (`latest`) declares `zod` as a peer: `^3.23.3 || ^3.24.0 || ^3.25.0`. `zod` `latest` is 4.6.5.
   - `npm install @copilotkit/sdk-js@1.73.3 zod@3` resolves zod 3.25.76.
   - A separate, unversioned `npm install zod` after the SDK selects 4.6.5 with only an "ERESOLVE overriding peer dependency" warning.
   - Adding the SDK to a project already on Zod 4 fails with `ERESOLVE`.
   - Installing both unversioned **in one command** picks 3.25.76, so the old wording ("an unversioned install selects Zod 4") was true only for a separate install. The note now says exactly that.

## Dependencies

Resolved versions after `npm ci`, unchanged from run a except the pdf-parse additions:

- **CopilotKit:** `@copilotkit/*` 1.73.3, with a single copy of `core` and `shared`.
- **AG-UI:**
  - `@ag-ui/core` / `client` 0.0.59, a single copy in both packages.
  - `@ag-ui/langgraph`: UI 0.0.43 (runtime) + 0.0.42 (`sdk-js`); agent 0.0.42.
  - `@ag-ui/mcp-apps-middleware` 0.1.1.
- **LangChain:**
  - `@langchain/core` 1.2.12, `@langchain/langgraph` 1.4.17, `@langchain/langgraph-sdk` 1.11.2.
  - `@langchain/langgraph-api` / `-cli` 1.5.0.
  - `@langchain/langgraph-checkpoint` 1.1.5, `@langchain/openai` 1.5.13, `langchain` 1.5.12.
- **UI:** `next` 15.5.26, `react` / `react-dom` 19.3.0.
- **Agent additions:** `pdf-parse` 1.1.4, `node-ensure` 0.0.0, `@types/pdf-parse` 1.1.5.

## Static checks

| Check                                                                                                                                             | Result                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph strict typecheck (`src/agent: tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck graph.ts`) | **Pass**, exit 0, 1192 files (`lgts-graph-strict-tsc-20260923b.log`)                                                                                                                                                    |
| `next build` (host equivalent of the Dockerfile build)                                                                                            | **Pass**, exit 0. Next 15.5.26, 57 static pages, 29.7 s, max RSS 2.66 GB. The warnings are the same as in run a: the hashbrown `Critical dependency` and workspace-root inference (`lgts-ui-next-build-20260923b.log`). |
| Informational: all graph modules, strict                                                                                                          | 8 errors, down from 9 in run a. The removed one is the `gen-ui-agent.ts` `recursionLimit` error. No new locations appear (`lgts-all-graphs-strict-tsc-20260923b.log`).                                                  |

## Boot

- **AIMock:** the same command and mode as run a (`--strict --validate-on-load`, `AIMOCK_STRICT_TURN_INDEX=1`, no record, proxy or provider flags). It loaded 8632 fixtures (`lgts-aimock-20260923b.log`).
- **Stack:** `npm run dev`, which runs `next dev --turbopack` plus `langgraph-cli@1.5.0 dev --port 8123`, with the same environment as run a (`lgts-dev-stack-20260923b.log`).
  - `.next` was removed first. It booted on the first attempt.
  - The UI came up on `*:3101`, and the agent on `[::1]:8123` with **29 graphs**. `info` returned 200.
- **Pre-warm:** 39/39 demo pages returned 200. The API status codes match run a (`lgts-prewarm-20260923b.log`).
- **Fresh boot for the matrix:** the red/green runs used an earlier boot of the same stack (`*-redgreen-20260923b.log`). That stack and AIMock were stopped, and both were booted fresh for the full matrix.

## Full strict D6 matrix

The command is the same as in run a:

```sh
AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts langgraph-typescript
```

It ran as one runner process, with `FEATURE_CONCURRENCY_D6=4` fixed in the shared driver.

|                   | Checks | Pass | Fail | Skipped |
| ----------------- | ------ | ---- | ---- | ------- |
| Raw matrix        | 40     | 39   | 1    | 0       |
| Published catalog | 40     | 39   | 1    | 0       |

- Duration: 166.3 s (21:59:00–22:01:46Z).
- AIMock journal: 138 requests, **0 strict 503s**. Run a had 26.
- Every check except `mcp-apps` passed on its first attempt.
- Logs and results: `lgts-d6-full-20260923b.log` and `lgts-runtime-matrix-20260923b.json`.
- The mapping of the 40 checks to demos is unchanged from run a. `beautiful-chat` expands into 5 checks. `declarative-json-render` is routed but not directly exercised, because the `byoc` check navigates only to `declarative-hashbrown`.
- **Policy-excluded, untested:** `gen-ui-interrupt` and `interrupt-headless`, which the manifest quarantines. Whether 1.73.3 fixes their resume path is still unknown.

| Check      | Full run                                                                                                                                                                    | Rerun (`--demo mcp-apps`, same stack)                                          | Classification                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `mcp-apps` | **FAIL** after the in-run retry (65.8 s): `waitForTurnComplete: turn 1 did not complete within 30000ms (reason=surface-missing, runsFinished=1, count=1, runningNow=false)` | **FAIL**, identical assertion (66.4 s; `lgts-d6-rerun-mcp-apps-20260923b.log`) | Real, deterministic; a new root cause (Remaining defect 1) |

How the `mcp-apps` failure was traced (`lgts-mcp-apps-journal-20260923b.json`, `lgts-mcp-apps-direct-run-*.sse`):

1. **Discovery is fixed.** The stack log has zero `MCP tool discovery failed` lines. Every `mcp-apps` model request carries `tools: ["create_view"]`, and the 9 Beautiful Chat requests now carry `create_view` too; run a silently lost those tools. AIMock matched the `create_view` tool-call fixture.
2. **The agent loses the tool call.** A direct `agent/run` against `/api/copilotkit-mcp-apps` streams text and snapshots, but **no `TOOL_CALL_*` events**. The raw `on_chat_model_end` output is a `generic` message with `tool_calls` absent and the call present only in `additional_kwargs.tool_calls`.
   - This is the langchain-js reassembly failure that `tool-rendering.ts`'s `normalizeAssistantMessage` already works around. The fixture streams text and a tool call in one message.
   - The MCP Apps middleware's `findPendingToolCalls` then finds nothing to execute, so no `ACTIVITY_SNAPSHOT` is emitted.
   - `mcp-apps` passed on 1.71.1 (`langgraph-typescript-host-d6-esm-webpack.log`), so this is a dependency-update regression.
3. **Diagnostic only.** A temporary, uncommitted patch to `mcp-apps.ts` promoted the `additional_kwargs` tool calls to an `AIMessage`, and was then restored byte-for-byte. The same direct run then emitted `TOOL_CALL_RESULT` and `ACTIVITY_SNAPSHOT` (`activityType: "mcp-apps"`, `resourceUri: "ui://excalidraw/mcp-app.html"`) against the live Excalidraw server. The patch was not D6-tested and is not committed.

## REPAIR-035 red/green (shared-state-read)

1. **First red attempt, for the wrong reason (`lgts-d6-shared-state-read-probe-defect-20260923b.log`).**
   - Against the old routing, the cell failed at the probe's edit step with "typed … but the input shows null" before any prompt was sent.
   - Cause: `d9467aa407`'s shared probe reads the title with `page.evaluate((selector) => …, RECIPE_TITLE_SELECTOR)`. The D6 driver's page wrapper is `evaluate: (fn) => page.evaluate(fn)` and drops the argument, so every integration's `shared-state-read` cell failed this way.
   - The probe's unit test used a fake page that ignored the closure, so it never caught this.
   - Fixed in `71f6525af9` by inlining the selector in the closure. The unit test now runs the closure against a stub document and drops the argument like the D6 wrapper does. It times out on the old probe and passes on the fixed one (`lgts-probe-unit-20260923b.log`).
2. **RED (`lgts-d6-shared-state-read-red-20260923b.log`, `lgts-shared-state-read-journal-red-20260923b.json`).**
   - Setup: the fixed probe, the gated fixture and the new graph, with `route.ts` still unchanged from HEAD (`shared-state-read` mapped to the starter graph).
   - The edit step passed. Turn 1 then timed out (`waitForTurnComplete … 60000ms, runningNow=true`) on both attempts.
   - Journal: all 14 requests were `gpt-5-mini` with roles `developer,user`, carried no edited title, and got a **503** strict no-match.
3. **GREEN (`lgts-d6-shared-state-read-green-20260923b.log`, `lgts-shared-state-read-journal-green-20260923b.json`).**
   - The route change was applied on the same stack (Turbopack hot reload).
   - The cell passed on the first attempt in 13.7 s. Both turns went out on `gpt-4o-mini` with roles `system,system,user…`, and **both system prompts contained "Lemon Saffron Orzo"**. Both were fixture-matched with 200.
4. **Full matrix:** `shared-state-read` passed again on the fresh boot (13.6 s).

Per `showcase/AGENTS.md`, this red/green covers one real cell. The probe fix also changes the LangGraph Python, ADK, Strands and other `shared-state-read` cells, which were **not rerun** here (one stack only).

## Documented setup reproduction

| Script                                                                                                                                                | Result                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reproduce-lgts-byoc-setup-20260923.sh`, run unchanged: a clone-equivalent copy, then `cp .env.example .env`, `cd src/agent && npm ci && npm run dev` | **PASS**, exit 0. 459 files copied, with no `node_modules` or `.langgraph_api`. `npm ci` added 254 packages (run a added 251 and failed). `:8123/ok` returned 200 after 3 s. **29 graphs** registered, and all 29 `GET /assistants/<id>/graph` returned 200 (`lgts-byoc-boot-20260923b.log`). |
| `reproduce-lgts-byoc-setup.sh`, replaced in `4147a5c04f` with the boot variant plus the 2026-09-13 strict `graph.ts` check                            | **PASS**, exit 0. The strict typecheck passes, 8123 is bound in 3 s, and 29/29 graphs return 200 (`lgts-byoc-setup-script-20260923b.log`).                                                                                                                                                    |

## Docs tests (all under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock`)

- `npm run pretypecheck && npm run typecheck`: **pass**. `typecheck` exited 0 and re-ran `pretypecheck` as its npm pre-hook, which also passed (`lgts-qual-shell-docs-typecheck-20260923b.log`).
- Guard `selected-showcase-guide-bindings.test.ts` (1 worker): **25/25** (`lgts-qual-guard-bindings-20260923b.log`).
- A focused run of 10 files with 2 workers covered `langgraph-typescript-doc-regions` (including the public-only setup test), `current-v2-authored-guides`, `llm-text`, `framework-gate`, `setup-content`, `setup-concept`, `setup-concept-rendering`, `selected-showcase-provenance`, `demo-code` and `intelligence-quickstart-docs` (`lgts-qual-docs-tests-20260923b.log`).
  - Result: **9 files and 177 tests pass**.
  - The only failure is the known pre-existing `intelligence-quickstart-docs`: "intelligence/connect-your-runtime is missing". Nothing else failed.
- Shared-frontend sync check: clean. Harness probe unit test: 5/5.

## Remaining defects

1. **`mcp-apps` (LangGraph TypeScript) loses the model's tool call.** This regression arrived with the update, and the endpoint fix exposed it.
   - `src/agent/mcp-apps.ts` returns the raw model response. When a streamed response carries text and a tool call together, it comes back as a `generic` message with the call only in `additional_kwargs.tool_calls`.
   - Proposed fix: normalize the response as `tool-rendering.ts` does, ideally through a shared helper, then run D6 red/green on `mcp-apps`. The diagnostic above shows the middleware then renders the app.
   - Other LangGraph TypeScript graphs that return text and a tool call in one message may be exposed the same way.
2. **AIMock 1.37.4 ignores `developer` messages for `systemMessage` matching on `/v1/chat/completions`.** Its Responses endpoint does map them. Any JS agent on a `gpt-5*` model therefore cannot be system-gated. The LangGraph TypeScript `shared-state-read` agent uses `gpt-4o-mini` to work around this. Fix this in AIMock (treat `developer` as `system` on Chat Completions); the agent can then return to `gpt-5-mini`.
3. **The shared-probe fix (`71f6525af9`) was verified on real Chromium for LangGraph TypeScript only.** LangGraph Python, ADK and Strands need a `shared-state-read` D6 rerun. Before this fix, all of them failed at the edit step.
4. **Minor:**
   - `a2ui-recovery-agent` still publishes the Showcase-only `forwardingFetch` / `headerForwardingMiddleware`, although the setup page explains them.
   - `tool-rendering-reasoning-chain.ts` still imports `BaseMessage` from `@langchain/langgraph`, a strict error; it is a type-only import.
   - The Strands manifest still describes its `shared-state-read` agent as a "neutral default agent".
   - Run a's defect 3, the open `@ag-ui/core` peer in `@copilotkit/shared`, is being fixed upstream in `a4e9126d08` by the other agent. The overrides remain until a release ships it.

## Limitations

- **AIMock replay is not a live provider.** Strict replay proves protocol, rendering and state behaviour against recorded fixtures. It does not prove model quality or real-provider compatibility.
  - `voice` covers the bundled transcript handoff only.
  - `multimodal` covers the sample-button path.
  - The `gpt-4o-mini` choice in `shared-state-read` has not been exercised against OpenAI.
- **Host-native, not Docker.** The build and boot ran on the host with Node 22. The Dockerfile's `npm ci --legacy-peer-deps` was validated only as an npm 10 dry run. The production `server.mjs` path was not booted, and its graph map was checked statically, by the doc-regions test.
- **External service.** MCP Apps and Beautiful Chat's Excalidraw tools depend on the live `https://mcp.excalidraw.com/mcp`, even under strict local replay. The cell is not hermetic, and an outage there would fail it.

## Cleanup

- The stack and AIMock were stopped with SIGTERM to their process groups, for both the red/green boot and the matrix boot. The runner sessions had already exited.
- No `langgraph-cli`, `llmock`, `run-local-d6`, Playwright or Chromium process remains.
- Ports 3101, 4410, 8123, 8124 and 2024 are free. The user's :3000 app (pid 91719) was never touched.
- The setup-reproduction temp copies under `/private/tmp` are gone.
- Left in place: ignored `.next/` (the `next build` output) and `src/agent/.langgraph_api/`.
