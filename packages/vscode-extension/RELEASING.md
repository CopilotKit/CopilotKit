# Releasing the VS Code extension

This package (`copilotkit-vscode-extension`) ships to two registries:

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=copilotkit.copilotkit-vscode-extension) — primary, used by VS Code, Cursor, etc.
- [Open VSX](https://open-vsx.org/extension/copilotkit/copilotkit-vscode-extension) — used by VSCodium, Gitpod, OpenVSCode Server, Theia-based IDEs.

Release automation is **version-bump local, publish in CI**. You never run `vsce publish` by hand.

## Prerequisites (one-time, maintainer)

Secrets must be configured in the **`production`** GitHub environment (repo → Settings → Environments → production → Environment secrets), not as plain repo secrets:

- `VSCE_PAT` — VS Code Marketplace Personal Access Token (Azure DevOps, scope: Marketplace → Manage, tied to the `copilotkit` publisher).
- `OVSX_PAT` — Open VSX Personal Access Token.

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

## Cutting a release (local)

From a clean checkout on `main`:

```bash
# Bump the patch version, commit, tag, and push.
scripts/release/vscode-extension-release.sh patch

# Or minor/major/explicit SemVer:
scripts/release/vscode-extension-release.sh minor
scripts/release/vscode-extension-release.sh 0.3.0

# Preview without mutating anything:
scripts/release/vscode-extension-release.sh patch --dry-run
```

The script:

1. Runs `pnpm version <bump> --no-git-tag-version` inside `packages/vscode-extension`.
2. Creates commit `chore(vscode-extension): release v<version>`.
3. Creates tag `vscode-extension-v<version>`.
4. Pushes both with `git push --follow-tags`.

The tag push fires `.github/workflows/publish-vscode-extension.yml`.

## CI publish flow

On tag push matching `vscode-extension-v*`:

1. Checkout, install, build.
2. Verify tag version matches `package.json` (fail loudly if not).
3. `vsce package` once → a single `extension.vsix`.
4. Upload `.vsix` as a workflow artifact (recoverable if a registry publish fails).
5. Publish the same `.vsix` to VS Code Marketplace with `$VSCE_PAT`.
6. Publish the same `.vsix` to Open VSX with `$OVSX_PAT`.
7. If either registry fails, the job fails and reports both outcomes.

Both publishes use `continue-on-error` so a partial failure is visible. We then reconcile in a final step — you never land in the state "Marketplace succeeded, Open VSX silently skipped."

## Transient registry failures

Both registries occasionally return transient `5xx` errors during publish. In particular, **Open VSX's `/publish` endpoint returns intermittent `502 Bad Gateway` errors** — a known Eclipse Foundation infra issue. VS Code Marketplace is more reliable but can also flake on `502`/`503`/`504`.

The CI workflow handles this automatically:

- Each publish step retries up to **5 times** with backoff (10s, 20s, 40s, 60s, 90s).
- Only transient conditions are retried: `5xx`, timeouts, connection resets, DNS (`EAI_AGAIN`). Auth (`401`/`403`, `TF400813`, "Invalid access token") and validation (`400`/`422`, manifest errors) fail fast with no retry.
- A `"version already exists"` response is treated as **idempotent success** — this handles the case where attempt N-1 actually landed on the registry but its response never reached us (e.g. `502` after commit), and attempt N sees the version already there.
- Each attempt is wrapped in `::group::` / `::endgroup::` so the per-attempt logs are collapsible in the GH Actions UI.

**If the workflow fails after all retries:**

1. Rerun the job from the GH Actions UI (Actions → failed run → *Re-run failed jobs*).
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
2. Run `scripts/release/vscode-extension-release.sh patch` to ship the fix.
3. If the regression is severe enough to warrant pulling the listing, the Marketplace / Open VSX admin UIs each offer a per-version unlist (different from unpublish) — use that as a last resort; prefer shipping forward.

## Notes and future work

- **ADO PAT retirement (2026-12-01):** Azure DevOps is sunsetting long-lived Marketplace PATs. CopilotKit has a separate playbook in Notion for migrating `VSCE_PAT` to the Entra ID / OIDC flow before that date.
- **If the npm monorepo release pipeline ever needs to coordinate with VSIX releases** (e.g. pin the extension to a known-good `@copilotkit/*` version), extend `release.config.json` with a `vscode-extension` scope and gate it behind the same tag trigger — do not try to bolt VSIX publishing onto `scripts/release/publish-release.ts` which is npm-only.
