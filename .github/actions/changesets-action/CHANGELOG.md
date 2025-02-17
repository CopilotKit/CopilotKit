# @changesets/action

## 1.4.9

### Patch Changes

- [#415](https://github.com/changesets/action/pull/415) [`57ab80c`](https://github.com/changesets/action/commit/57ab80c61104c270bebc125910ae32da3a5aca46) Thanks [@benmccann](https://github.com/benmccann)! - Improve error message when attempting to publish without publish script defined

## 1.4.8

### Patch Changes

- [#393](https://github.com/changesets/action/pull/393) [`48ab0d2`](https://github.com/changesets/action/commit/48ab0d2f2e77ae169182d022591ef5c18c931ff2) Thanks [@s0](https://github.com/s0)! - Ensure the PR remains open when updated

- [#393](https://github.com/changesets/action/pull/393) [`48ab0d2`](https://github.com/changesets/action/commit/48ab0d2f2e77ae169182d022591ef5c18c931ff2) Thanks [@s0](https://github.com/s0)! - Switch to cheaper API for querying existing PRs

## 1.4.7

### Patch Changes

- [#255](https://github.com/changesets/action/pull/255) [`f2660aa`](https://github.com/changesets/action/commit/f2660aa7e78365f53dbeb4cfa774c1499ec6483a) Thanks [@ernestognw](https://github.com/ernestognw)! - Allow customize PR `branch` field

## 1.4.6

### Patch Changes

- [#350](https://github.com/changesets/action/pull/350) [`9385be9`](https://github.com/changesets/action/commit/9385be9e757839189ea5ee63ec4e3caa8a6ca71b) Thanks [@m-shaka](https://github.com/m-shaka)! - Bump the used node.js from 16 to 20

## 1.4.5

### Patch Changes

- [#282](https://github.com/changesets/action/pull/282) [`eb19e25`](https://github.com/changesets/action/commit/eb19e25e7797cf33dc2de4caa071e85a8057a0f0) Thanks [@mark-omarov](https://github.com/mark-omarov)! - Updated a few dependencies to patch the security vulnerabilities that were reported for their older versions.

## 1.4.4

### Patch Changes

- [#291](https://github.com/changesets/action/pull/291) [`db8a109`](https://github.com/changesets/action/commit/db8a1099bc0ba1dd6f46a5b9df4212e4f69e78c9) Thanks [@varl](https://github.com/varl)! - Wire up [`@octokit/plugin-throttling`](https://github.com/octokit/plugin-throttling.js) with all GitHub Octokit instances

## 1.4.3

### Patch Changes

- [#289](https://github.com/changesets/action/pull/289) [`8b28186`](https://github.com/changesets/action/commit/8b2818674de86a7fc69aebb9ed6b486ee32eb96e) Thanks [@varl](https://github.com/varl)! - Use logging provided by `@actions/core`

## 1.4.2

### Patch Changes

- [#286](https://github.com/changesets/action/pull/286) [`225a1e8`](https://github.com/changesets/action/commit/225a1e8cbcabb7b585174ba0ad806549db40d4cd) Thanks [@varl](https://github.com/varl)! - This patch implements the [`@octokit/plugin-throttling`](https://github.com/octokit/plugin-throttling.js) plugin and [wires
  it up with the internal GitHub Octokit instance](https://github.com/actions/toolkit/tree/457303960f03375db6f033e214b9f90d79c3fe5c/packages/github#extending-the-octokit-instance).

  This plugin is recommended by [the Octokit docs](://octokit.github.io/rest.js/v19#throttling) as it implements all the GitHub [best practices for integrators](https://docs.github.com/en/rest/guides/best-practices-for-integrators?apiVersion=2022-11-28).

  This should help with `changesets/action` gitting spurious secondary rate limits and failing CI jobs, for which the only known workaround is to simply re-run the job.

## 1.4.1

### Patch Changes

- [#123](https://github.com/changesets/action/pull/123) [`b78f480`](https://github.com/changesets/action/commit/b78f48099899f0a853c5d9cd3feb21a5440babbd) Thanks [@Andarist](https://github.com/Andarist)! - Updated `@actions/*` dependencies to avoid using deprecated features of the runner.

## 1.4.0

### Minor Changes

- [#216](https://github.com/changesets/action/pull/216) [`398d7ed`](https://github.com/changesets/action/commit/398d7ed) Thanks [@quinnjn](https://github.com/quinnjn)! - Execute action with node16 instead of node12.

### Patch Changes

- [#228](https://github.com/changesets/action/pull/228) [`bff53cc`](https://github.com/changesets/action/commit/bff53cc50c1ebb33f8f558f9de2e0eb9a99230c6) Thanks [@iansan5653](https://github.com/iansan5653)! - Add `is:pull-request` to search query when looking for existing PR. This fixes an issue with user-owned PATs.

* [#206](https://github.com/changesets/action/pull/206) [`8c3f5f5`](https://github.com/changesets/action/commit/8c3f5f5637a95a2327e78d5dabcf357978aedcbb) Thanks [@glasser](https://github.com/glasser)! - Skip creating a PR when all existing changesets are empty.

## 1.3.0

### Minor Changes

- [#167](https://github.com/changesets/action/pull/167) [`993a0a0`](https://github.com/changesets/action/commit/993a0a090df78cee07481d3886dcd8b29deb9567) Thanks [@dmregister](https://github.com/dmregister)! - Added `pullRequestNumber` to the action's outputs

### Patch Changes

- [#157](https://github.com/changesets/action/pull/157) [`521c27b`](https://github.com/changesets/action/commit/521c27bf86ec53547d6a350d208fbbbc9d576fbc) Thanks [@emmenko](https://github.com/emmenko)! - Automatically adjust GitHub PR message if it exceeds a size limit of 60k characters by omitting some of the changelog information.

## 1.2.2

### Patch Changes

- [#161](https://github.com/changesets/action/pull/161) [`52c9ce7`](https://github.com/changesets/action/commit/52c9ce75d9d8a14ea2d75e4157b0c15b7a4ac313) Thanks [@bicknellr](https://github.com/bicknellr)! - Change directory to `cwd` before running git user setup. This fixes an issue when the action starts its execution not in a git repository.

## 1.2.1

### Patch Changes

- [#144](https://github.com/changesets/action/pull/144) [`898d125`](https://github.com/changesets/action/commit/898d125cee6ba00c6a11b6cadca512752c6c910c) Thanks [@Andarist](https://github.com/Andarist)! - Updated all Changesets dependencies. This should fix parsing issues for completely empty summaries that has been fixed in `@changesets/parse@0.3.11`.

## 1.2.0

### Minor Changes

- [#130](https://github.com/changesets/action/pull/130) [`5c0997b`](https://github.com/changesets/action/commit/5c0997b25e175ecf5e1723ba07210bbcea5d92fb) Thanks [@akphi](https://github.com/akphi)! - Added `createGithubReleases` input option (defaults to `true`) to control whether to create Github releases during publish or not.

* [#134](https://github.com/changesets/action/pull/134) [`1ed9bc2`](https://github.com/changesets/action/commit/1ed9bc24b7a56462c183eb815c8f4bdf0e2e5785) Thanks [@dmregister](https://github.com/dmregister)! - Added `cwd` input option that can be used in projects that are not in the root directory.

## 1.1.0

### Minor Changes

- [#128](https://github.com/changesets/action/pull/128) [`1937303`](https://github.com/changesets/action/commit/19373036c4bad4b0183344b6f2623a3b0e42da6c) Thanks [@dhruvdutt](https://github.com/dhruvdutt)! - Setup the git user in the local config instead of the global one.

* [#131](https://github.com/changesets/action/pull/131) [`d3db9ec`](https://github.com/changesets/action/commit/d3db9eceaf41d42c56d5370d504c86851627188f) Thanks [@jacklesliewise](https://github.com/jacklesliewise)! - Added `setupGitUser` option to enable or disable setting up a default git user

## 1.0.0

### Major Changes

- [#118](https://github.com/changesets/action/pull/118) [`05c863d`](https://github.com/changesets/action/commit/05c863d3f980125585016a593b5cb45b27d19c2c) Thanks [@Andarist](https://github.com/Andarist)! - From now on this action will be released using the Changesets-based workflow (using itself). Thanks to that we'll have a good release history. The users will be able to find specific versions of the action and will be able to track changes over time. It also improves the security as the build artifact will always get built in the CI environment, using a frozen lockfile.
