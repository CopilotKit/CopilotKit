# Bug-fix PR security checklist

Used by Gate 0 of the `bugfix-pr` skill. Mark `alert` only on high-confidence findings. Prefer `review` when suspicious but not proven.

## Always inspect

1. **Full file list** — `gh pr view N --json files` / `gh pr diff`.
2. **New or modified scripts** — anything under `scripts/`, `bin/`, `.husky/`, `hooks/`, `lefthook.yml`, `dangerfile.ts`, CI configs.
3. **Dependency manifests** — `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `pyproject.toml`, `uv.lock`, `poetry.lock`, `requirements*.txt`, `Cargo.toml`, `go.mod`, etc.
4. **Workflows & CI** — `.github/workflows/**`, `action.yml`, composite actions, `nx`/`turbo` pipeline hooks.
5. **Install lifecycle** — `preinstall` / `postinstall` / `prepare` / `prepublishOnly` scripts in package.json (root or workspaces), `.pnpmfile.cjs`, and `.npmrc`. pnpm runs `.pnpmfile.cjs` on every install.
6. **Obfuscation** — long base64 blobs, `eval`, `Function(`, `child_process`, `curl|bash`, `wget`, reverse shells, encoded PowerShell.
7. **Secrets & exfil** — reading `process.env` for tokens/keys and sending outbound (`fetch`, `axios`, `http`, `https`, `dns`, unexpected WebSocket).
8. **Binary / unexpected assets** — new `.exe`, `.dll`, `.so`, `.dylib`, packed binaries, large unexplained blobs.
9. **Lockfile-only attacks** — dependency version pins to typosquat packages, git URLs, or non-registry tarball URLs.
10. **Permission escalation** — workflow `pull_request_target` with untrusted checkout, `write` permissions on `contents`/`secrets`, unpinned `uses: org/action@main`.

## alert (block all mutations)

Any of:

- Clear malware / reverse shell / crypto miner / credential stealer patterns.
- Exfiltration of `GITHUB_TOKEN`, npm tokens, cloud keys, or private source to a third party.
- Typosquat or unknown package that executes on install (postinstall network + download).
- `pull_request_target` workflow that checks out PR code and runs it with secrets.
- Hidden malicious code in minified/vendor files introduced by the PR with no justification.
- Force-adding deploy keys, webhooks, or package publish credentials.

## review (human before apply)

- Broad CI permission changes without clear need.
- New network calls in build tooling with weak justification.
- Large unrelated file churn mixed with a small claimed fix.
- Binary files without explanation.
- Dependency bumps that also change install scripts.
- Encoded or generated code the agent cannot fully audit.

## clean

- Docs, tests, typed feature work with no install/CI/network red flags.
- Straightforward dependency bumps with lockfile consistency and no new lifecycle scripts.
- In-house bot PRs (Dependabot/Renovate) that only touch manifests/lockfiles in the usual way.

## What not to cry wolf on

- Normal `fetch` to documented APIs in application code.
- Test fixtures that _look_ like secrets but are clearly fake (`sk-test-...`, `example.com`).
- Vendored third-party code already used by the project when the PR is a version bump with a known release.

## Output

Put up to 5 concrete reasons in the **Security** part of the report, e.g.:

- `package.json: postinstall curls http://…`
- `.github/workflows/ci.yml: pull_request_target + untrusted checkout`
- `scripts/setup.sh: base64|bash pipeline`
