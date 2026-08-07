# Issue triage automation

Stop-the-bleeding automation for incoming issues. Three workflows, one shared
analysis module. Everything is **advisory / high-confidence / reopen-friendly** —
nothing closes an issue on an LLM's say-so.

| Workflow              | Trigger                      | LLM? | What it does                                                                                                                                                                                     |
| --------------------- | ---------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `triage-stale.yml`    | daily cron                   | no   | Marks `needs-info` issues stale after 14d of silence, closes 7d later. Scoped to `needs-info` only, so it never touches active issues. Exempts `defer,Triaged,Roadmap,💎 Bounty`. PRs untouched. |
| `triage-on-open.yml`  | `issues: opened`             | yes  | One combined classify + dedup pass. Applies allow-listed labels (conf ≥ 0.75) and flags likely duplicates with an advisory comment (conf ≥ 0.8). Never closes.                                   |
| `triage-backfill.yml` | manual (`workflow_dispatch`) | yes  | Same analysis over the existing open backlog. **Dry-run by default** — previews in the job summary; only applies when you uncheck dry-run. Capped by `max_issues`.                               |

`analyze.js` is the single source of truth for the LLM logic (search for
candidates → one combined Anthropic call → return proposals). Both the on-open
and backfill workflows call it, so policy and safety controls live in one place.

## Setup

1. **Model provider** — the two LLM workflows need ONE provider; with none they
   clean-skip (log and exit, no failures). `triage-stale` needs nothing.
   - **Azure OpenAI / Foundry (preferred — draws on shared credits):** secret
     `AZURE_OPENAI_API_KEY`; repo **Variables** `AZURE_OPENAI_ENDPOINT` and
     `AZURE_OPENAI_DEPLOYMENT` (optional `AZURE_OPENAI_API_VERSION`, default `2024-10-21`).
   - **Anthropic (fallback):** secret `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`).
   - Force one with the `TRIAGE_PROVIDER` variable (`azure` | `anthropic`); otherwise
     it's inferred from whichever credentials are present (Azure wins if both are set).
2. **Curate the label allow-list.** The classifier may apply _only_ the labels in
   `APPLYABLE` (top of `triage-on-open.yml` / `triage-backfill.yml`). It's
   default-deny and currently holds the repo's real content labels only —
   `bug, feature request, documentation, question, mcp, examples`. Curation/
   disposition labels (`good first issue`, `help wanted`, `Triaged`, `defer`,
   `spam`, bounty, release…) are intentionally excluded — those are human calls.
   Adjust per repo.
3. **First run:** dispatch `triage-backfill` with dry-run **on** and a small
   `max_issues` to eyeball the proposals before letting it apply anything.

## Safety model

- **Constrained action space** — the LLM never posts free text. It returns
  structured JSON; the workflow applies validated labels and templated comments.
- **Default-deny labels** — only allow-listed labels can be applied.
- **Confidence gates** — labels ≥ 0.75, dedup ≥ 0.8; dedup also requires the
  target to be one of the candidates we actually searched.
- **Flag, never close** — duplicates get a label + a "a maintainer will confirm"
  comment. Humans close.
- **Spam/low-signal gate** — already-flagged or empty-body-from-outsider issues
  skip the LLM call entirely (cost guard).
- **Pinned actions** — checkout / github-script / stale / harden-runner are
  SHA-pinned, with `persist-credentials: false` (no git ops).
- **Least privilege** — every workflow defaults to `permissions: {}`; each job
  opts into only `contents: read` + `issues: write`. Nothing else is granted.
- **No template injection** — `workflow_dispatch` inputs are passed via `env`
  and read from `process.env`, never interpolated into the inline script.
- **Egress monitoring** — [StepSecurity Harden-Runner](https://github.com/step-security/harden-runner)
  runs first in every job (`egress-policy: audit`). Review the network report,
  then flip to `block` with the allow-list commented in each workflow so the
  model key can only reach GitHub + your model host.
- **Endpoint pinning** — `analyze.js` refuses to send the key to any non-Azure
  host (guards against the endpoint `var` being repointed).
- **Bounded runtime** — `timeout-minutes` on every job caps a hung model call.

### Not yet automated (operator actions)

- **Provider spend cap** — set a hard quota/spend limit on the model provider
  (Azure deployment TPM quota / Anthropic workspace monthly limit). This is the
  real backstop against issue-flood cost-DoS (an event-driven workflow can't hold
  a global rate limit); do it when you configure the provider.
- **Flip Harden-Runner to `block`** after one `audit` baseline run.
- **Confirm Renovate doesn't auto-merge** action SHA bumps (review them by hand).
