# Antigravity Repo Doctor

An AI agent that finds out why a GitHub repository's CI is failing, fixes it, and asks you before it does anything risky. Built with [CopilotKit](https://github.com/CopilotKit/CopilotKit) and the [Antigravity AG-UI SDK (`ag-ui-antigravity`)](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/antigravity/python), on [Google Antigravity](https://github.com/google-antigravity/antigravity-sdk-python) and Gemini.

https://github.com/user-attachments/assets/5d8cca98-b0fb-4178-bb81-29e473d036b3

## What it does

Name any public repository, or pick one of the cards, and ask why CI is failing. The agent clones it, reads the latest
GitHub Actions results and works through it like a developer would:

- **Asks before anything risky.** Installs, checks, file edits, shell commands and pushes stop on an approve or deny
  card in the chat. An Auto-approve switch answers them for you, except pushes.
- **Proves the failure, then the fix.** It reproduces the failing CI step as one short command, which must fail
  before the fix and pass after. The Check panel shows both runs.
- **Shows its work.** The fix appears as a diff card (a React component the agent's `show_diff` call renders through
  `useRenderTool`), and every test run appears as a test results card, red then green. The agent describes that card
  with [A2UI](https://a2ui.org/) and CopilotKit draws it.
- **Keeps your history.** With CopilotKit Intelligence, conversations and every approval decision are saved, and
  they reopen on any device. You can archive or delete a conversation from the list. Product Analytics shows which
  tools the agent calls, how often runs fail and how many people use it.
- **Pushes a fix branch.** The demo pushes to a local remote, so it never writes to a real repository. Pushing to a
  real repository or your own fork is left out on purpose and would need a small code change (see
  [Safety](docs/architecture.md#safety)).

When CI is green it says so and stops. A downloadable report at the end lists the cause, the change, the
verification and every approval.

The sample uses `google-gemini/genai-processors`, whose CI is failing. It is on the start screen as a suggestion,
next to `CopilotKit/CopilotKit`.

Other public repos with failing CI to try:

- `gruns/furl`: the CI workflow's Tox step fails on Python 3.9 to 3.13, a newer `ipaddress` rejects a hostname the tests expect to parse.
- `requests/toolbelt`: the CI workflow's Test with tox step fails, newer pyOpenSSL warns that X509 objects are deprecated and the tests treat that warning as an error.
- `kurtmckee/feedparser`: the Test workflow's test suite step fails in `test_strict_parser`, 6 cases on the strict XML parser.

How it is built, tool by tool, is in [docs/architecture.md](docs/architecture.md). The step-by-step recipe is in the
[CopilotKit cookbook](https://docs.copilotkit.ai/cookbook/antigravity-repo-doctor).

## Prerequisites

- Node.js 22 or newer and [pnpm](https://pnpm.io/)
- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- `git`, and a C compiler for projects with native extensions (Xcode command line tools on macOS)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Run locally

```bash
git clone https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit/examples/showcases/antigravity-repo-doctor
pnpm install && pnpm dev
```

The first `pnpm dev` creates `.env`, installs the Python agent with uv and stops if `GEMINI_API_KEY` is empty. Add
your key to `.env` and run `pnpm dev` again. The app starts on http://localhost:3000 and the agent on port 8000.

Type your name in the navbar, then pick a card or ask about any public `owner/name`.

### CopilotKit Intelligence: saved conversations and analytics

```bash
npx copilotkit@latest login
npx copilotkit@latest project select --create repo-doctor --env-name .env
```

This adds `CPK_INTELLIGENCE_API_KEY` to `.env`. Restart `pnpm dev` and a conversation list appears on the left. The
name you type in the navbar is your user id, so the same name on another device opens the same conversations. It is
not a login: before a public deploy, replace `identifyUser` in `src/app/api/copilotkit/[[...slug]]/route.ts` with
your own auth.

## Environment variables

All in one `.env` at the root. Only `GEMINI_API_KEY` is required.

| Variable                                             | What it does                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                                     | Gemini API key.                                                                                                                                     |
| `GEMINI_MODEL`                                       | Any Gemini model id. Default `gemini-3.5-flash`.                                                                                                    |
| `GEMINI_THINKING_LEVEL`                              | `minimal`, `low`, `medium` or `high`. Lower is cheaper and faster.                                                                                  |
| `GITHUB_TOKEN`                                       | A read-only token for GitHub API reads (cards and CI results). Raises the limit from 60 to 5,000 requests an hour. Never reaches the agent's shell. |
| `CPK_INTELLIGENCE_API_KEY`                           | Turns on saved conversations and Product Analytics.                                                                                                 |
| `WORKSPACE_BUCKET`                                   | `gs://bucket` to save each conversation to Cloud Storage and restore it after a restart.                                                            |
| `DEMO_USER_ID`                                       | The user id before a name is typed. Default `repo-doctor-demo`.                                                                                     |
| `APP_URL`                                            | The deployed URL, for link previews.                                                                                                                |
| `MAX_TOOL_CALLS_PER_TURN`, `COMMAND_TIMEOUT_SECONDS` | Limits per turn and per command. Defaults 60 and 600.                                                                                               |

Folder settings (`WORKSPACE_ROOT`, `SAVE_DIR`, `PUSH_ROOT`, `VENV_ROOT`, `UV_CACHE_DIR`) and the rest are described in
`.env.example`.

## How it works

```
Browser (CopilotKit chat, cards, workspace panel)
   │
   ▼
Next.js: CopilotKit runtime  ──►  CopilotKit Intelligence (saved conversations, analytics)
   │  AG-UI
   ▼
Python agent: Antigravity AG-UI SDK + Repo Doctor tools
   │
   ▼
Antigravity harness  ──►  Gemini
   │
   ▼
One workspace per conversation: the cloned repo, its venv, a local push remote
```

1. The chat sends your message to the CopilotKit runtime, which forwards it to the Python agent over AG-UI.
2. The agent runs on Google Antigravity through the Antigravity AG-UI SDK. Antigravity calls Gemini and runs tools: its
   own file tools for reading and editing code, plus Repo Doctor's tools for cloning, reading CI, installing,
   testing, checking, showing the diff and pushing.
3. Before a risky tool runs, the agent pauses and the chat shows an approval card. Your answer resumes the same run.
4. Tools update shared state, which drives the workspace panel on the right. Each test run returns an A2UI surface,
   which the chat renders as the test report card.
5. Each conversation gets its own folder. With `WORKSPACE_BUCKET` set, the folder and the agent's session are saved
   to Cloud Storage after every run, and restored if the service restarts.

The full picture, including every tool, the approval flow, safety and the saved conversations, is in
[docs/architecture.md](docs/architecture.md).

## Project structure

```
├── src/
│   ├── app/api/copilotkit/        CopilotKit runtime: the agent over AG-UI, A2UI, Intelligence
│   ├── app/api/workspaces/        Deletes a conversation's files when it is deleted
│   ├── components/chat/           Approval card, diff card, tool rows, check and test cards
│   ├── components/shell/          Navbar, conversation list, workspace panel
│   ├── a2ui/                      The A2UI catalog for the test report
│   └── lib/                       Shared state, GitHub card data, the report download
├── agent/src/repo_doctor/
│   ├── agent.py                   The Antigravity agent: approvals, one workspace per conversation
│   ├── tools.py                   clone_repo, ci_status, install_dependencies, run_tests, run_check, show_diff, git_push
│   ├── project.py                 Install and test commands for Python, Node, Go and Rust projects
│   ├── guards.py                  What the agent may not do (package installs from the shell)
│   ├── safety.py                  What reaches GitHub (pushes stay local) and the keys removed from its environment
│   ├── snapshot.py                Saving and restoring conversations in Cloud Storage
│   └── prompts.py                 The system prompt
├── e2e/                           End-to-end test with a scripted model
├── Dockerfile                     One image for Cloud Run
└── docs/architecture.md
```

## Deploy to Google Cloud

The whole app runs as one Cloud Run service: the UI, the CopilotKit runtime and the agent. Conversations are saved
to a Cloud Storage bucket, one folder per conversation. Run these from the project root with the
[gcloud CLI](https://cloud.google.com/sdk/docs/install), after `gcloud auth login`.

**1. Project and image**

```bash
PROJECT=your-project
REGION=us-central1
IMAGE=$REGION-docker.pkg.dev/$PROJECT/repo-doctor/app
gcloud config set project $PROJECT

gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create repo-doctor --repository-format=docker --location=$REGION
gcloud builds submit --tag $IMAGE
```

If the build fails with a permission error, give the build account the builder role:

```bash
NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $PROJECT \
  --member=serviceAccount:$NUMBER-compute@developer.gserviceaccount.com --role=roles/cloudbuild.builds.builder
```

**2. Secrets** (read from your `.env`, never printed)

```bash
secret() { grep "^$1=" .env | cut -d= -f2- | tr -d '\n"' | gcloud secrets create "$2" --data-file=-; }
secret GEMINI_API_KEY gemini-api-key
secret CPK_INTELLIGENCE_API_KEY cpk-intelligence-api-key
secret GITHUB_TOKEN github-token
```

**3. A service account that can only read those secrets and the bucket**

```bash
gcloud iam service-accounts create repo-doctor --display-name="Repo Doctor"
SA=repo-doctor@$PROJECT.iam.gserviceaccount.com
# A new service account takes a few seconds to appear, so each binding retries.
for s in gemini-api-key cpk-intelligence-api-key github-token; do
  for try in 1 2 3 4 5 6; do
    gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA \
      --role=roles/secretmanager.secretAccessor && break
    sleep 10
  done
done

BUCKET=$PROJECT-repo-doctor-ws
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$SA --role=roles/storage.objectUser
```

**4. Deploy**

```bash
gcloud run deploy repo-doctor \
  --image $IMAGE --region $REGION --service-account $SA \
  --min-instances 1 --max-instances 1 \
  --cpu 4 --memory 16Gi --no-cpu-throttling \
  --timeout 3600 --execution-environment gen2 \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,CPK_INTELLIGENCE_API_KEY=cpk-intelligence-api-key:latest,GITHUB_TOKEN=github-token:latest \
  --set-env-vars GEMINI_MODEL=gemini-3.5-flash,DEMO_USER_ID=repo-doctor-demo,WORKSPACE_BUCKET=gs://$BUCKET \
  --no-allow-unauthenticated

APP_URL=$(gcloud run services describe repo-doctor --region $REGION --format='value(status.url)')
gcloud run services update repo-doctor --region $REGION --update-env-vars APP_URL=$APP_URL
```

The service is private. Open it on your machine through an authenticated proxy, then go to http://localhost:8080:

```bash
gcloud run services proxy repo-doctor --region $REGION --port 8080
```

To share it with named people, put it behind
[IAP](https://cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run).

**Public link (opt in).** Only if you want anyone with the URL to use it:

```bash
gcloud run services add-iam-policy-binding repo-doctor --region $REGION \
  --member=allUsers --role=roles/run.invoker
```

Everyone with the link can then spend your Gemini credits and run commands in the container.

> **Security.** Code from the cloned repositories runs inside the container with network access. A production
> deployment needs real authentication and a sandbox per conversation; see [Safety](docs/architecture.md#safety).

Why these settings:

- **One instance, always on.** A conversation's live session and any approval card it is waiting on are held in
  memory, so the service runs exactly one instance and never scales to zero. CPU stays on while the agent waits for
  you, and a single run may last up to an hour.
- **4 vCPU, 16 GiB.** On Cloud Run the disk is memory. It holds the cloned repos, their installed packages and the
  test runs, with room for a few people at once. 2 vCPU and 8 GiB is enough for one person.
- **Saved conversations.** After every run, the repo, its pushed fix branches and the agent's session are saved to
  `gs://$BUCKET/ws/<conversation>/`. If the service restarts, the next message in that conversation restores them
  and the agent continues where it left off. Installed packages are not saved; the agent reinstalls them.
- **Cost.** An always-on instance bills around the clock. When you are done, run
  `gcloud run services update repo-doctor --region $REGION --min-instances 0` or delete the service.

Update after a code change:

```bash
gcloud builds submit --tag $IMAGE
gcloud run deploy repo-doctor --image $IMAGE --region $REGION
```

Logs:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="repo-doctor"' --limit 100
```

## Testing

```bash
pnpm test:agent          # agent unit tests
pnpm typecheck && pnpm lint
```

The end-to-end test runs the real app, harness, tools and shell with a scripted model in place of Gemini, so it
costs nothing:

```bash
pnpm mock-model                                                            # terminal 1
GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:4010 GEMINI_API_KEY=mock pnpm dev   # terminal 2
pnpm e2e                                                                   # terminal 3
```

`pnpm e2e` clicks the first card and answers every approval through to the push. `node e2e/run-flow.mjs --deny`
denies the first approval, and `--command` approves a shell command.

## Tech stack

| Layer         | Stack                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Next.js 16, React 19, Tailwind v4, CopilotKit `@copilotkit/react-core`                                                                      |
| Generative UI | `useInterrupt` (approve or deny card), `useRenderTool` (diff card and tool rows), A2UI with `@copilotkit/a2ui-renderer` (test results card) |
| Runtime       | `@copilotkit/runtime`, `@ag-ui/client`, CopilotKit Intelligence                                                                             |
| Agent         | Python 3.13, FastAPI, Antigravity AG-UI SDK (`ag-ui-antigravity`), `google-antigravity`                                                     |
| Model         | Gemini (`gemini-3.5-flash` by default)                                                                                                      |
| Deploy        | Cloud Run, Cloud Storage, Secret Manager                                                                                                    |
