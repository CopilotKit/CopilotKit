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

| Runtime       | Resolved relevant versions                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node          | `v22.16.0`                                                                                                                  |
| LGP UI        | Next `15.5.19`                                                                                                              |
| LGTS UI       | Next `15.5.19`                                                                                                              |
| ADK UI        | Next `15.5.19`                                                                                                              |
| Strands UI    | Next `15.5.18`                                                                                                              |
| LGP agent     | `ag-ui-protocol 0.1.18`, `ag-ui-langgraph 0.0.41`, `langgraph-api 0.7.101`, `langgraph-cli 0.4.21`, `copilotkit 0.1.94`     |
| ADK agent     | `ag-ui-protocol 0.1.18`, `ag-ui-adk 0.7.0`, `google-adk 2.8.0`                                                              |
| Strands agent | `ag-ui-protocol 0.1.18`, `ag-ui-strands 0.2.2`, `strands-agents 1.18.0`, `strands-agents-tools 0.2.16`, `copilotkit 0.1.94` |

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

## Command classes used

1. `npm --prefix showcase/integrations/<slug> ci --legacy-peer-deps` for the five
   app packages and LGTS agent package.
2. `uv pip install --python <temporary-venv>/bin/python -r
showcase/integrations/<python-slug>/requirements.txt` for the three Python
   agents.
3. Existing app entrypoints: Next dev on the ports defined in
   `showcase/shared/local-ports.json`; LangGraph CLI for LGP/LGTS; Uvicorn from
   `src` for ADK and Strands. Each was configured with the existing local AIMock
   environment and an integration-specific agent URL.
