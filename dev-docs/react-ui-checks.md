# Fix a failing React UI check

The `React Doctor and impeccable` CI job checks the React UI code that your change touches in `packages/`, `examples/`, and `showcase/`:

- [React Doctor](https://react.doctor/docs) finds React bugs, slow renders, accessibility problems, and security problems.
- [impeccable](https://impeccable.style) detect finds UI design problems, for example low contrast and AI-template styles.

The job is in `.github/workflows/static_react-ui.yml`. Both tools are pinned as root dev dependencies. The script that runs them is `scripts/lint/react-ui-checks.sh`.

## Run the checks locally

From the repo root:

```sh
pnpm lint:react-doctor
pnpm lint:impeccable
```

Both compare your branch, including uncommitted changes, with `origin/2.0.0`. To compare with a different branch, add it: `pnpm lint:react-doctor origin/main`.

## Why your PR failed

The two checks decide what counts as new in different ways:

- **React Doctor** reports only issues that your change adds. It uses its own `--scope changed` mode, so old issues in a file do not fail the check.
- **impeccable** has no changed-only mode, so it scans every UI file that you changed. Old findings in those files count too. Tests and stories are not scanned.

To fix a finding:

1. Open the file at the line in the output.
2. Fix the code.
3. Run the check again.

To see the reason and the fix for a React Doctor rule, run `pnpm exec react-doctor why <file>:<line>`. The impeccable rule catalog is at [impeccable.style/slop](https://impeccable.style/slop).

If a finding is wrong for one line, turn it off with a comment that gives the reason:

```tsx
// react-doctor-disable-next-line react-doctor/no-array-index-as-key -- static list that never reorders
```

```tsx
<header>
  {/* impeccable-disable-next-line gradient-text -- the partner's brand wordmark */}
  <h1 className="bg-gradient-to-r bg-clip-text text-transparent">Acme</h1>
</header>
```

## Configuration

- `doctor.config.json` sets `adoptExistingLintConfig: false`, so React Doctor does not run the `.oxlintrc.json` rules. The oxlint job already checks them. It also turns off the supply-chain scan, which needs the network.
- React Doctor warnings fail the check, not only errors (`--blocking warning`).
- Advisory impeccable findings never fail the check.

## Upgrade a tool

Change the exact version in the root `package.json`, run `pnpm install`, and commit `package.json` and `pnpm-lock.yaml`. A new version can add rules, but only code that a PR changes is checked, so the upgrade does not fail on old code.
