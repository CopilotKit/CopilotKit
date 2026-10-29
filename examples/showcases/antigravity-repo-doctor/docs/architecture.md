# Architecture

How Antigravity Repo Doctor is put together, for anyone changing or extending it. The README covers running and
deploying it.

## Processes

```
Browser
  CopilotChat, tool renderers, approval card, A2UI test report, workspace panel, conversation list
     │ HTTP: /api/copilotkit/*
     ▼
Next.js (src/app/api/copilotkit/[[...slug]]/route.ts)
  CopilotRuntime
   - agent "repo-doctor": an HttpAgent pointed at AGENT_URL
   - A2UI middleware (the agent writes its own surfaces, so no injected tool)
   - CopilotKit Intelligence when CPK_INTELLIGENCE_API_KEY is set, otherwise an in-memory runner
     │ AG-UI over HTTP and server-sent events
     ▼
Python agent (agent/src/repo_doctor, FastAPI on 127.0.0.1:8000)
  Antigravity AG-UI SDK (ag-ui-antigravity): create_antigravity_app(ThreadScopedAntigravityAgent)
  + GET /health + DELETE /threads/{id}/workspace
     │ local WebSocket
     ▼
Antigravity harness (a Go binary shipped in the google-antigravity wheel)
  calls Gemini, runs the built-in file and shell tools inside the conversation's workspace
```

In Docker, one container runs both: `docker/entrypoint.sh` starts the agent, waits for `/health`, then starts the
Next.js server on `$PORT`. If either process exits, the container exits.

## A message, end to end

1. The user clicks a card or types. The chat adds the message and starts a run.
2. The runtime identifies the user (`identifyUser` reads the `rd_user` cookie set by the navbar name) and, with
   Intelligence, records the run under that user and conversation.
3. The runtime posts an AG-UI `RunAgentInput` to the agent and streams its events back to the browser.
4. `ThreadScopedAntigravityAgent.run` logs any approval answers into shared state, then runs the Antigravity AG-UI
   SDK. With `WORKSPACE_BUCKET` set, it first restores the conversation from Cloud Storage if its folder is missing.
5. The Antigravity AG-UI SDK finds or creates the session for the conversation. `_build_agent` points it at the conversation's
   own workspace folder and binds Repo Doctor's tools to that folder.
6. Antigravity sends the turn to Gemini. Tool calls run either in the harness (built-in tools) or in the Python
   process (Repo Doctor's tools). Results go back to Gemini and, as AG-UI events, to the browser.
7. When the run ends, the conversation is saved in the background.

## Tools

Repo Doctor's own tools (`tools.py`):

| Tool                               | What it does                                                                                                                                                                                         | Approval |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `clone_repo(repo_ref)`             | Shallow clone. The GitHub remote is renamed `upstream` with pushing disabled, and a local bare repository becomes `origin`. Returns the install and test commands and the project's optional extras. | no       |
| `ci_status()`                      | Newest GitHub Actions run of each workflow on the default branch, with failed jobs and steps.                                                                                                        | no       |
| `install_dependencies(command)`    | Runs the detected install command. For Python, `-e .` may become `-e .[extra,...]` for extras the project declares. Anything else is refused.                                                        | yes      |
| `run_tests(target)`                | Runs the test command and returns an A2UI test report.                                                                                                                                               | no       |
| `run_check(command, label)`        | Runs one shell command (120 s limit) to reproduce the failing CI step, before and after the fix.                                                                                                     | yes      |
| `show_diff(summary)`               | The real `git diff`, rendered as the diff card.                                                                                                                                                      | no       |
| `git_push(branch, commit_message)` | Commits tracked changes on a new branch and pushes it to the local bare repository by path (not `origin`), with git hooks off. Refuses when the repo's config rewrites URLs.                         | yes      |

Antigravity's built-in tools used: `view_file`, `list_dir`, `grep_search`, `find_by_name` (no approval),
`replace_file_content` and `run_command` (approval). `finish` ends each turn.

Install and test commands come from the project's own files (`project.py`): Python with uv (pytest when the project
uses it, otherwise unittest), Node (pnpm, npm, yarn or bun from the lockfile or `packageManager`), Go and Rust. A
project whose programs are not on the PATH is reported as unsupported. The Docker image has Python and Node with npm,
pnpm and Yarn (Corepack shims), but not Bun, Go or Rust.
pytest results come from its JUnit report; other runners from the summary they print.

## Approvals

`tool_approval=True` on the Antigravity AG-UI SDK's agent registers a hook that pauses any tool not on the auto-approve list. The current
AG-UI run ends with an interrupt; the chat's `useInterrupt` renders the approval card; the user's answer starts a new
run whose `resume` entry releases the paused call, inside the same harness turn.

Every answer is logged into `state.approvals` (approved, denied with an optional note, or auto), so the history
survives with the conversation. A denial ends the turn with a short message instead of an error.

## Limits

`guards.py` adds a hook that runs before the approval hook:

- `run_command` may not install packages (pip, uv, npm, pnpm, yarn, bun, poetry, conda, apt and similar). The call
  is rejected and returned to the model as a tool error that points it to `install_dependencies`. `uv run --with`
  stays allowed, for one-off reproductions.
- PyTorch always installs as CPU wheels: `UV_TORCH_BACKEND=cpu` and the PyTorch CPU index for pip are set in the
  agent's environment. Cloud Run has no GPU, and the CUDA packages are gigabytes.

The harness does not call hooks for `manage_task` (checking or stopping background commands), so that tool cannot be
limited this way. In practice, the agent can still stop a background command it started. If the harness then drops
the conversation, the next message rebuilds the session from its saved record and is sent again, so the
conversation carries on.

Other limits: `MAX_TOOL_CALLS_PER_TURN` (default 60) and `COMMAND_TIMEOUT_SECONDS` (default 600) for Repo Doctor's
own commands.

## Shared state and UI

Tools write shared state with the Antigravity AG-UI SDK's `experimental_set_state`; each write reaches the browser as a state
snapshot. `src/lib/use-workspace.tsx` reads it once and the workspace panel renders Repository, Check, Tests,
Approvals and the pushed branch.

`run_tests` returns `a2ui_operations` for a fixed `TestReport` component, one surface per run, so red and green stay
side by side. The catalog is in `src/a2ui/`.

The report download (`src/lib/report.ts`) is built in the browser from state and messages, so it works on reopened
conversations too.

## Safety

- Pushes stay local by design. `git_push` pushes the fix branch to a local remote, so the demo never writes to a real
  repository. The cloned repository's GitHub remote is read-only, and git's environment config sends any github.com
  push to an invalid host. Pushing to a real repository or your own fork is left out on purpose and would need a
  small code change.
- At startup the agent removes API keys and tokens from its own environment, so the harness, shell commands and
  cloned code never see them. Repo Doctor's subprocesses get an allowlisted environment.
- In Docker the app code is read-only to the user the agent runs as.

Code from a cloned repository still runs with network access. A public deployment should add real authentication in
front of the runtime and, ideally, a sandbox per conversation.

## Workspaces and saved conversations

Each conversation has a key, the first 10 hex characters of the SHA-256 of its id:

| Path                            | Holds                                               |
| ------------------------------- | --------------------------------------------------- |
| `WORKSPACE_ROOT/<key>`          | the cloned repository                               |
| `PUSH_ROOT/<key>.git`           | the local remote fix branches are pushed to         |
| `VENV_ROOT/<key>`               | the Python venv; the repo's `.venv` is a link to it |
| `SAVE_DIR/<conversation id>.db` | the harness's record of the conversation            |

Venvs stay on local disk because an install writes tens of thousands of files. A conversation's venv is deleted
when its session closes (30 minutes idle, or 2 hours waiting on an approval). The agent uses its own uv cache
(`UV_CACHE_DIR`), pruned at startup and cleared when it passes `UV_CACHE_MAX_BYTES`, never during an install.

With `WORKSPACE_BUCKET` set, `snapshot.py` saves each conversation to `ws/<key>/` in the bucket after a clone, a push
and every run:

| Object          | Holds                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------- |
| `repo.tar.gz`   | the repository with its history and edits, without `.venv`, `node_modules` and build output   |
| `remote.tar.gz` | the local push remote                                                                         |
| `session.db`    | the harness conversation, copied with SQLite's backup API                                     |
| `meta.json`     | commit, save time, the harness conversation id and the messages it already has (written last) |

When a run arrives for a conversation whose folder is missing, the folder is restored first and the Antigravity AG-UI SDK is
given the saved conversation id, so the next session resumes the saved conversation: the model sees the earlier
turns and the repository has its edits. Approval cards that were waiting cannot survive a restart.

Repositories over `SNAPSHOT_MAX_BYTES` (500 MB) are not saved, with a warning in the log. Deleting a conversation in
the app calls `DELETE /api/workspaces/<id>`, which removes its local folders, harness record and bucket folder.

If the harness closes a conversation's connection, the next message rebuilds the session from the saved record and
is sent again in the same run.

## Cloud Run sizing

The container's disk is memory. It holds the repositories, venvs (hard-linked from the uv cache), the cache itself
(about 1.2 GB for genai-processors' packages) and running test suites (about 1 GB each). 4 vCPU and 16 GiB fits a
few people at once; 2 vCPU and 8 GiB fits one.

## Locking down network access

Not set up here. On Cloud Run: Direct VPC egress with all traffic through the VPC, Cloud NAT, and a Cloud NGFW
policy with FQDN rules allowing only `github.com`, `codeload.github.com`, `api.github.com`,
`generativelanguage.googleapis.com`, `api.intelligence.copilotkit.ai`, `realtime.intelligence.copilotkit.ai`,
`storage.googleapis.com` and the package registries (`pypi.org`, `files.pythonhosted.org`,
`download.pytorch.org`, `registry.npmjs.org`).

## Tests

- `agent/tests/`: unit tests for the tools, project detection, approvals, limits, saved conversations and session
  rebuilds.
- `e2e/`: `mock-model.mjs` is a scripted Gemini served by aimock; `run-flow.mjs` drives the real app in Chrome. Only
  the model's decisions are scripted. Playbooks: genai-processors (the full fix), the second card (CI only), a
  shell command, a denial, and older tqdm and beets-filetote runs.
