# Releasing the VS Code extension

This package (`copilotkit-vscode-extension`) ships to two registries:

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=copilotkit.copilotkit-vscode-extension) — primary, used by VS Code, Cursor, etc.
- [Open VSX](https://open-vsx.org/extension/copilotkit/copilotkit-vscode-extension) — used by VSCodium, Gitpod, OpenVSCode Server, Theia-based IDEs.

The flow mirrors the [`CopilotKit/aimock`](https://github.com/CopilotKit/aimock) release model: contributors hand-edit `package.json` + `CHANGELOG.md` and land a release commit on `main`; CI detects the version is not yet on the Marketplace and publishes. **No tag is created by hand. No `vsce publish` is run by hand.**

## Prerequisites (one-time, maintainer)

Configuration lives in the **`production`** GitHub environment (repo → Settings → Environments → production), split between non-secret **variables** and **secrets**:

Environment **variables** (non-secret, consumed by `azure/login@v2`):

- `AZURE_CLIENT_ID` — client ID of the `copilotkit-vscode-publish` Entra Service Principal.
- `AZURE_TENANT_ID` — tenant ID for copilotkit.ai.
- `AZURE_SUBSCRIPTION_ID` — subscription the SP is scoped into.

Environment **secrets**:

- `OVSX_PAT` — Open VSX Personal Access Token (bot-owned, quarterly rotation). OIDC is not yet supported on Open VSX, so a PAT is still required here.
- `VSCE_PAT` — **retained as explicit rollback only.** No longer referenced by the workflow; Marketplace auth is OIDC. Delete this secret once OIDC publishing has been confirmed green at least once in production (see [Rollback guidance](#rollback-guidance)).
- `SLACK_WEBHOOK` (optional) — webhook for the #oss-alerts release ping. Publish succeeds without it.

### One-time Open VSX setup (first release only)

Open VSX requires claiming the namespace before the first publish:

1. Maintainer signs up at <https://open-vsx.org> with their GitHub identity.
2. Creates a personal access token at <https://open-vsx.org/user-settings/tokens>.
3. Claims the publisher namespace (one-time, from any machine):

   ```bash
   npx --yes ovsx create-namespace copilotkit -p <token>
   ```

4. Stores the token as `OVSX_PAT` in the `production` GH environment.

Once the namespace is claimed, subsequent CI publishes run unattended.

## Cutting a release

Cutting a release is two file edits, one commit, one PR.

1. Bump `packages/vscode-extension/package.json` — increment the `version` field (e.g. `0.1.0` → `0.1.1` for a patch, `0.2.0` for a minor, `1.0.0` for a major).
2. Prepend an entry to `packages/vscode-extension/CHANGELOG.md`:
   ```md
   ## 0.1.1 — 2026-04-22

   ### Fixed
   - Hook Explorer crash on empty workspaces

   ### Added
   - New "Copy AG-UI run URL" command
   ```
   Use Keep-a-Changelog subsections: `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security`.
3. Commit both files with subject **`chore: release vX.Y.Z`** (conventional prefix required by commitlint).
4. Push, open a PR, get review, merge with a merge commit (NOT squash — the `chore: release` commit must land on `main` as-is so the publish workflow's self-gate can find it).

On merge, CI auto-publishes to the VS Code Marketplace and Open VSX, tags `vscode-extension-vX.Y.Z`, cuts a GitHub Release, and posts to `#oss-alerts`.

## CI publish flow

On every push to `main` under `packages/vscode-extension/**`, `.github/workflows/publish-vscode-extension.yml` runs:

1. Reads `version` from `packages/vscode-extension/package.json`.
2. Calls `vsce show <publisher>.<name>` and checks whether that exact version is already listed on the Marketplace.
3. If already published → no-op (green, zero side effects). This makes every non-release push to main safe.
4. Otherwise: install, build, `vsce package` → single `extension.vsix`, upload artifact.
5. Marketplace auth is GitHub OIDC → Entra federated Service Principal → `vsce publish --azure-credential`. No user PAT. The SP is `copilotkit-vscode-publish` in the copilotkit.ai tenant with Contributor role on the Marketplace `copilotkit` publisher. `azure/login@v2` sources `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` from the `production` environment **variables** (not secrets) and populates the `AzureCliCredential` chain that `vsce` reads by default. A `verify-pat --azure-credential` pre-flight step catches auth issues before we publish.
6. Publish the same `.vsix` to Open VSX with `$OVSX_PAT` (bot-owned PAT, quarterly rotation — OIDC is not yet supported on Open VSX).
7. Create tag `vscode-extension-v<version>` and push it.
8. Cut a GitHub Release using the CHANGELOG section for that version (or auto-generated notes if absent).
9. Post a Slack message to `SLACK_WEBHOOK` if configured.

The federated credential on the Entra SP is pinned to subject `repo:CopilotKit/CopilotKit:environment:production`, which means the workflow's `environment: production` must match **exactly** (case-sensitive) for the OIDC token exchange to succeed.

Both publishes use `continue-on-error` so a partial failure is visible. The final "Report publish results" step fails the job if either registry ultimately failed — you never land in "Marketplace succeeded, Open VSX silently skipped."

## Transient registry failures

Both registries occasionally return transient `5xx` errors during publish. In particular, **Open VSX's `/publish` endpoint returns intermittent `502 Bad Gateway` errors** — a known Eclipse Foundation infra issue. VS Code Marketplace is more reliable but can also flake on `502`/`503`/`504`.

The CI workflow handles this automatically:

- Each publish step retries up to **5 times** with backoff (10s, 20s, 40s, 60s, 90s).
- Only transient conditions are retried: `5xx`, timeouts, connection resets, DNS (`EAI_AGAIN`). Auth (`401`/`403`, `TF400813`, "Invalid access token") and validation (`400`/`422`, manifest errors) fail fast with no retry.
- A `"version already exists"` response is treated as **idempotent success** — this handles the case where attempt N-1 actually landed on the registry but its response never reached us (e.g. `502` after commit), and attempt N sees the version already there.
- Each attempt is wrapped in `::group::` / `::endgroup::` so the per-attempt logs are collapsible in the GH Actions UI.

**If the workflow fails after all retries:**

1. Rerun the job from the GH Actions UI (Actions → failed run → _Re-run failed jobs_).
2. **Do NOT bump the version.** The same tag + version is safe to re-publish because both registries treat "version already exists" as idempotent in our retry logic — whichever one previously succeeded will short-circuit, and the one that failed will get a fresh attempt.

**For manual publishes** (emergencies only — prefer CI):

- If `npx ovsx publish ...` fails with a `502`, just retry the same command 2–3 times.
- If `vsce publish` fails with a `5xx`, same — retry. Auth errors (`TF400813`) mean the PAT is bad; don't retry, fix the token.

## Verifying

After CI goes green:

- Marketplace: <https://marketplace.visualstudio.com/items?itemName=copilotkit.copilotkit-vscode-extension>
- Open VSX: <https://open-vsx.org/extension/copilotkit/copilotkit-vscode-extension>
- Smoke test install:

  ```bash
  code --install-extension copilotkit.copilotkit-vscode-extension --force
  ```

  (for VSCodium / Cursor, use their respective CLIs with the same extension ID.)

## Rollback

**Both registries treat published versions as immutable.** You cannot unpublish or replace a bad version — you can only publish a patch that supersedes it.

If a bad version ships:

1. Fix the regression on a branch, open a PR, land it on `main`.
2. Bump the patch version in `packages/vscode-extension/package.json`, prepend a `### Fixed` entry to `CHANGELOG.md`, commit as `chore: release vX.Y.Z`, open a PR, and merge.
3. If the regression is severe enough to warrant pulling the listing, the Marketplace / Open VSX admin UIs each offer a per-version unlist (different from unpublish) — use that as a last resort; prefer shipping forward.

## Rollback guidance

### OIDC auth failures

If the `Login to Azure` or `Verify Marketplace credential` step fails on the first OIDC publish, check these in order:

1. **SP not added as Contributor on the Marketplace publisher.** `copilotkit-vscode-publish` must be a member of the `copilotkit` publisher at <https://marketplace.visualstudio.com/manage/publishers/copilotkit> with the Contributor (or higher) role.
2. **Federated credential subject mismatch.** The credential on the Entra app must have subject **exactly** `repo:CopilotKit/CopilotKit:environment:production` (case-sensitive, no trailing slash). The workflow's `environment: production` must match that subject byte-for-byte.
3. **Tenant conditional access policy blocking workload identities.** The copilotkit.ai tenant may have CA policies that block service principals from non-corporate IPs. Check Entra → Security → Conditional Access and exclude the `copilotkit-vscode-publish` SP from any policy that filters on location.
4. **Missing `permissions: id-token: write` on the `publish` job.** Without this, GitHub will not mint an OIDC token and `azure/login@v2` will fail with "Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable".

### Temporary rollback to PAT

`VSCE_PAT` is retained in the `production` environment secrets specifically as a rollback lever for this cutover window. To revert:

1. Check out `.github/workflows/publish-vscode-extension.yml`, replace `--azure-credential` with `--pat "$VSCE_PAT"`, and re-add the `env: { VSCE_PAT: ${{ secrets.VSCE_PAT }} }` block on the `Publish to VS Code Marketplace` step.
2. Push. Ship the release. Debug OIDC out of band.

### Retiring the PAT

Once OIDC publishing has been confirmed green in CI at least once, **delete `VSCE_PAT` from the `production` environment**. That commit — the one that removes the last Marketplace PAT from the pipeline — is the actual completion of this migration. Until then the PAT is still a live credential and still needs to be treated as one for rotation / incident response purposes.

## Notes and future work

- **ADO PAT retirement (2026-12-01):** Azure DevOps is sunsetting long-lived Marketplace PATs. This workflow has been migrated to OIDC / federated credentials ahead of that date; `VSCE_PAT` is retained only as a short-lived rollback lever (see above).
- **If the npm monorepo release pipeline ever needs to coordinate with VSIX releases** (e.g. pin the extension to a known-good `@copilotkit/*` version), extend `release.config.json` with a `vscode-extension` scope and gate it on the same version-on-main trigger — do not try to bolt VSIX publishing onto `scripts/release/publish-release.ts` which is npm-only.
