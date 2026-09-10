# HOST-NATIVE-001: selected-five local launch checkpoint

**Purpose:** make the selected-five runtime audit runnable without a Docker image
rebuild. This is a launch and health checkpoint, not feature-pass evidence. The
D6 runner owns feature execution and its results.

## Source and scope

- Product baseline examined: `fa6041fc7b08fc5866099769038e43c44c1ce8df`.
- Baseline subject: `fix(web-inspector): point the Learning pane's setup button at
Learning (#7037)`.
- The working tree contained audit artifacts from other agents. Before this
  checkpoint, `git diff --name-only` and `git status --short`, limited to all five
  integration directories, were empty. No tracked product source or lockfile was
  changed by host setup.
- The running AIMock is `http://127.0.0.1:4410`; its health response was
  `{"status":"ok"}`. Each host process receives the existing mock API-key/base-URL
  environment contract. No provider credentials were used.

## Installed host dependencies

All Node dependencies were installed with the checked-in package-lock input and
`npm ci --legacy-peer-deps`; Python environments are isolated outside the worktree
at `/private/tmp/copilotkit-host-native-python/{langgraph-python,google-adk,strands}`
using Python 3.12.6 and the checked-in requirements files. No lockfile was written.

| Runtime       | Resolved relevant versions                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Node          | `v22.16.0`                                                                                                                     |
| LGP UI        | Next `15.5.19`                                                                                                                 |
| LGTS UI       | Next `15.5.19`                                                                                                                 |
| ADK UI        | Next `15.5.19`                                                                                                                 |
| Strands UI    | Next `15.5.18`                                                                                                                 |
| LGP agent     | `ag-ui-protocol 0.1.18`, `ag-ui-langgraph 0.0.41`, `langgraph-api 0.7.101`, `langgraph-cli 0.4.21`, `copilotkit 0.1.94`        |
| ADK agent     | `ag-ui-protocol 0.1.18`, `ag-ui-adk 0.7.0`, `google-adk 2.8.0`                                                                 |
| Strands agent | `ag-ui-protocol 0.1.18`, `ag-ui-strands 0.2.2`, `strands-agents 1.18.0`, `strands-agents-tools 0.2.16`, `copilotkit 0.1.94`    |
| All five UIs  | `@copilotkit/react-core 1.68.2`, `@copilotkit/runtime 1.68.2`                                                                  |
| BIA UI extras | `@copilotkit/a2ui-renderer 1.68.2`, `@copilotkit/shared 1.68.2`, `@copilotkit/voice 1.68.2`                                    |
| LGTS agent    | `@langchain/langgraph 1.3.0`, `@langchain/langgraph-api 1.1.17`, `@langchain/langgraph-sdk 1.6.5`, `@copilotkit/sdk-js 1.68.2` |

These are observed resolved versions, not a claim that the checked-in ranges are
the latest public stable releases.

## Ready endpoints

| Integration            | UI / health                                     | Agent / health                              | Launch session IDs                                 | Status           |
| ---------------------- | ----------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ---------------- |
| `built-in-agent`       | `http://127.0.0.1:3117/api/health` returned 200 | In process                                  | `40237`                                            | ready            |
| `langgraph-typescript` | `http://127.0.0.1:3101/api/health` returned 200 | `http://localhost:8124/ok` returned 200     | UI `46096`, agent `95359`                          | ready            |
| `langgraph-python`     | `http://127.0.0.1:3100/api/health` returned 200 | `http://127.0.0.1:8123/ok` returned 200     | UI `69854`, agent `56274`                          | ready            |
| `strands`              | `http://127.0.0.1:3112/api/health` returned 200 | `http://127.0.0.1:8002/health` returned 200 | UI `5008`, agent `49759`                           | ready            |
| `google-adk`           | no listener                                     | `http://127.0.0.1:8001/health` returned 200 | agent `31798`; UI start ended before session ready | frontend blocked |

The D6 runner was given each ready endpoint and owns strict feature execution. It
was instructed to leave these services running. This checkpoint did not use the
unknown-provenance stale Docker LGP container.

## Selected-five LFS media setup

The BIA multimodal run exposed `sample.png` as an LFS pointer. These are the only
LFS objects restored for the selected-five local media tests:

```text
git lfs pull --include showcase/integrations/built-in-agent/public/demo-files/sample.png
git lfs pull --include 'showcase/integrations/built-in-agent/public/demo-files/sample.pdf,showcase/integrations/built-in-agent/public/demo-audio/sample.wav,showcase/integrations/langgraph-python/public/demo-files/sample.png,showcase/integrations/langgraph-python/public/demo-files/sample.pdf,showcase/integrations/langgraph-python/public/demo-audio/sample.wav,showcase/integrations/langgraph-typescript/public/demo-files/sample.png,showcase/integrations/langgraph-typescript/public/demo-files/sample.pdf,showcase/integrations/langgraph-typescript/public/demo-audio/sample.wav,showcase/integrations/google-adk/public/demo-files/sample.png,showcase/integrations/google-adk/public/demo-files/sample.pdf,showcase/integrations/google-adk/public/demo-audio/sample.wav,showcase/integrations/strands/public/demo-files/sample.png,showcase/integrations/strands/public/demo-files/sample.pdf,showcase/integrations/strands/public/demo-audio/sample.wav'
```

`file` verified all 15 as a 393×90 PNG, one-page PDF 1.4, or RIFF/WAVE PCM mono
16 kHz as appropriate. Path-limited `git status --short` for the five affected
`public/` directories was empty.

## LangGraph TypeScript Turbopack blocker

The LGTS UI starts and can initially serve pages, but later API-route compilation
fails with unresolved `./schema.js`, `./edge-headers.js`, and `./emit.js` imports
from `src/cvdiag/cvdiag-emitter.ts`. This is not a missing checkout: all referenced
co-located `.ts` files are tracked and present. The emitter deliberately uses
NodeNext `.js` specifiers; `next.config.ts:13-25` configures a Webpack-only
`.js`-to-`.ts/.tsx/.js` extension alias for them. The checked-in `package.json:6`
dev command uses `next dev --turbopack`, which does not apply that Webpack alias.
The observed Next overlay imports trace through `cvdiag-backend.ts` to
`src/app/api/copilotkit/route.ts`, and affected API responses return 500.

The source and config were already present in `fa6041fc7b08fc5866099769038e43c44c1ce8df`;
path-limited LGTS diff/status were clean. D6 outcomes from this Turbopack launch
are setup-blocked and cannot qualify features. Use an existing compatible
Webpack build/start contract for a rerun, or record a product repair after the
audit; this checkpoint applies neither.

The local rerun uses the existing default Next development mode instead of the
checked-in Turbopack shortcut, with the same mock environment and deployment URL:

```text
cd showcase/integrations/langgraph-typescript
LANGGRAPH_DEPLOYMENT_URL=http://localhost:8124 ./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3101
```

It became ready on session `59763`; `/api/health` and `/demos/agentic-chat`
returned 200 before the runner was notified. This establishes a valid local
Webpack-mode rerun environment while leaving the default dev command defect
recorded separately.

## Google ADK frontend blocker: observed baseline defect

The Google ADK agent and its health endpoint launch normally. Its UI cannot start,
so it cannot be offered to the local D6 runner.

Reproduction from
`/Users/tylerslaton/.codex/worktrees/3715/CopilotKit/showcase/integrations/google-adk`:

```text
env [existing AIMock variables] AGENT_URL=http://127.0.0.1:8001 \
  ./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port 3103
```

Observed result before any port is opened:

```text
Error: You cannot define a route with the same specificity as a optional catch-all route
("/api/copilotkit-auth" and "/api/copilotkit-auth[[...slug]]").
```

The conflicting checked-in route files are
`showcase/integrations/google-adk/src/app/api/copilotkit-auth/route.ts:1` and
`showcase/integrations/google-adk/src/app/api/copilotkit-auth/[[...slug]]/route.ts:1-4`.
The manifest declares the root auth handler for the Authentication demo at
`showcase/integrations/google-adk/manifest.yaml:464-475`. Since the route tree is
validated at Next startup, all ADK UI routes are unavailable in this launch, rather
than only `/demos/auth`.

`git diff --name-only -- showcase/integrations/google-adk` and the matching
path-limited `git status --short` were both empty immediately after reproduction.
Therefore the finding describes the existing baseline and no source fix was applied.

## Exact launch commands and environment

[`host-native-launch.sh`](host-native-launch.sh) contains the exact commands used,
including all seven mock-value environment variables, working directories, temporary
Python interpreter paths, ports, and frontend-to-agent bindings. It starts every
process independently; it is a reproducibility record, not a test harness or a
process-cleanup script.

## Dependency installation commands

1. `npm --prefix showcase/integrations/<slug> ci --legacy-peer-deps` for the five
   app packages and LGTS agent package.
2. `uv pip install --python <temporary-venv>/bin/python -r
showcase/integrations/<python-slug>/requirements.txt` for the three Python
   agents.
3. Existing app entrypoints: Next dev on the ports defined in
   `showcase/shared/local-ports.json`; LangGraph CLI for LGP/LGTS; Uvicorn from
   `src` for ADK and Strands. Each was configured with the existing local AIMock
   environment and an integration-specific agent URL.
