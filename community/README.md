# Community packages

This folder holds frontend packages for CopilotKit that the community builds and maintains. CopilotKit supports them lightly. The public description of this tier is the [Community frameworks](https://docs.copilotkit.ai/community-frameworks) page.

Each package lives in its own folder, `community/<name>/`. A package in this folder is not part of the CopilotKit monorepo build. It cannot break a CopilotKit pull request, and a CopilotKit change cannot break it in the same pull request.

## What lightly supported means

- **Tested with one version.** The package pins the exact `@copilotkit/*` versions it is tested with.
- **Updates are best effort.** The package can fall behind CopilotKit releases. The maintainer updates it on their own schedule.
- **Separate releases.** The package does not release with the CopilotKit monorepo, and it never blocks a CopilotKit release.
- **The package README is the guide.** The CopilotKit docs do not include setup guides or API reference for community packages.

## Requirements for a package

The `test / community` workflow checks these requirements. When files under `community/` change, the workflow runs. It does not run for other changes.

1. **Not a workspace member.** Do not add the folder to `pnpm-workspace.yaml`. Nx finds projects through the pnpm workspace. So the package stays out of every monorepo build, type check and test run.
2. **Its own pnpm root.** Commit these files in the package folder:
   - A `pnpm-workspace.yaml` that contains `packages: ["."]`. Without it, pnpm finds the repository workspace above the folder and installs the monorepo instead of the package. An `.npmrc` setting does not stop this.
   - A `pnpm-lock.yaml`.
   - A `packageManager` field in `package.json` that pins an exact `pnpm@` version.
3. **Published CopilotKit versions, pinned exactly.** Depend on published `@copilotkit/*` versions such as `"1.77.0"`. Do not use `workspace:*`, and do not use a range such as `^1.77.0`. Framework packages use internal `@copilotkit/core` APIs (the `ɵ` exports), and those APIs can change in any release.
4. **Four scripts.** Define `lint`, `typecheck`, `test` and `build` in `package.json`. The workflow runs each one, and each one must pass.

The repository gates still apply to files in this folder:

- **Build config files** (`vite.config.*`, `next.config.*` and similar) need an exact entry in `.github/config-allowlist.txt`. A change to that file needs a review from the core team.
- **A public `@copilotkit/*` package** needs an entry in `scripts/package-licenses/policy.json`.

## Adding a package

1. Open a pull request that adds `community/<name>/` and meets the requirements above.
2. In the same pull request, add a line for the folder to `.github/CODEOWNERS` that names you as the maintainer.
3. In the same pull request, add a row for the package to the Community frameworks page. The page is `showcase/shell-docs/src/content/docs/community-frameworks.mdx`. Include the `@copilotkit/core` version that the package is tested with.

## Releases

A community package is published through the CopilotKit release pipeline, under its own scope and its own version line. The core team adds the scope. The maintainer does not.

To add the scope, the core team does these steps in one pull request:

1. Add the scope to `release.config.json`, with `"sharedVersion": false` and the package as its `versionSource`.
2. Add the scope name to the `ReleaseScope` type in `scripts/release/lib/config.ts`.
3. Add the scope to the `scope` options in `publish-release.yml`, `stable-release.yml` and `canary.yml`. If one of these lists does not match `release.config.json`, the `verify-release-scope-dropdowns.sh` gate fails.

The release scripts find packages in `community/` as well as in `packages/`. The root build does not build community packages, because nx does not see them. So the publish workflow runs `scripts/release/build-community-packages.ts`. This script installs and builds each community package in the release scope inside its own folder.

## Retiring a package

Some packages fall far behind CopilotKit and have no active maintainer. We can mark such a package as behind on the Community frameworks page, or remove it from this folder. Requests to update a package tell us that people use it, so we read them before we retire a package.
