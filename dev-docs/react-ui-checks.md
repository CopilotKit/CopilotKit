# Fix a failing React UI check

Two CI jobs scan the React code in `packages/`, `examples/`, and `showcase/`:

- `React Doctor` runs [React Doctor](https://react.doctor/docs). It finds React bugs, slow renders, accessibility problems, and security problems.
- `impeccable detect` runs [impeccable](https://impeccable.style) detect. It finds UI design problems, for example low contrast, text that is too small, and AI-template styles.

Both jobs are in `.github/workflows/static_react-ui.yml`. A React project is a directory under those three folders whose `package.json` lists `react` as a dependency, a peer dependency, or a dev dependency.

## Run the checks locally

Install the pinned tools once, then run the checks from the repo root:

```sh
npm ci --prefix tools/ui-checks
pnpm lint:react-doctor
pnpm lint:impeccable
```

These commands run the same checks as CI. The tools are in `tools/ui-checks/`, with their own lockfile, so that they do not change the root `pnpm-lock.yaml`.

## Why your PR failed

The check fails when your change adds a finding. Old findings do not fail the check. They are recorded in `.lint-baseline/react-doctor.json` and `.lint-baseline/impeccable.json`, as a count per rule and file.

The output names the file, the rule, and the first line that fails:

```text
1 new finding(s) in 1 file(s), over the baseline:

examples/v2/react-router/app/root.tsx
  react-doctor/no-array-index-as-key: 1 (allowed 0)
    first: line 62: Array index used as a key
```

1. Open the file at the line in the output.
2. Fix the code.
3. Run the check again.

To see the reason and the fix for a React Doctor rule, run:

```sh
tools/ui-checks/node_modules/.bin/react-doctor why <file>:<line> --no-telemetry
```

The impeccable rule catalog is at [impeccable.style/slop](https://impeccable.style/slop).

If a finding is wrong for one line, turn it off with a comment and give the reason:

```tsx
// react-doctor-disable-next-line react-doctor/no-array-index-as-key -- static list that never reorders
```

```tsx
<header>
  {/* impeccable-disable-next-line gradient-text -- the partner's brand wordmark */}
  <h1 className="bg-gradient-to-r bg-clip-text text-transparent">Acme</h1>
</header>
```

Do not edit `.lint-baseline/` by hand. Do not write the baseline again to hide a new finding.

## The check says the baseline is stale

You fixed old findings. The baseline still allows them, so the check fails until you record the fix.

1. Run `pnpm lint:react-doctor:prune` or `pnpm lint:impeccable:prune`.
2. Commit the smaller file in `.lint-baseline/`.

Prune only lowers counts. It never allows a new finding.

## The counts change when you run it locally

The check counts findings in tracked files only, so build output does not count. Local installs can still change the result. For example, a `node_modules` folder in a showcase integration can change the React version that React Doctor reads. CI installs the root workspace only. If your local counts differ from CI, trust CI.

## Configuration

- `doctor.config.json` sets `adoptExistingLintConfig: false`. React Doctor does not run the rules in `.oxlintrc.json`, because the oxlint job already checks them. It also turns off the supply-chain scan, which needs the network.
- Advisory impeccable findings are not counted. impeccable does not fail on them either.

## Upgrade a tool

1. Change the exact version in `tools/ui-checks/package.json`.
2. Run `npm install --prefix tools/ui-checks` to update `tools/ui-checks/package-lock.json`.
3. Run `pnpm lint:react-doctor:baseline` or `pnpm lint:impeccable:baseline`. A new version can add or change rules.
4. Commit the tool files and the new baseline together.
