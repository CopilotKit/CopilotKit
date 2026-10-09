# Changelog — angular lane

`@copilotkit/angular`, which versions independently of the monorepo packages
(`scopes.angular` in `release.config.json`).

`release / create-pr` prepends a section here for each release, and
`release / publish` reads the newest section back as the GitHub Release body.
To change what ships, edit the section on the release PR branch before merging.

Entries begin with the first release cut after this file was added. The file
this replaces was a changesets-era artifact that stopped at `1.54.3`, from
before the lane split off onto its own `0.x` line, and it is recoverable from
git history (`git show angular/v0.5.0:packages/angular/CHANGELOG.md`).

## 0.5.3 - 2026-10-07

### Features

- feat(core): let a frontend tool resume its pending calls on reconnect (#7615) (a0480fa)
- feat(mcp-apps): consolidate the Vue and Angular hosts onto the shared package (#7161) (06f61ae)
- feat: AG-UI 1.0 for CopilotKit (#7270) (7693a04)
- feat(angular)!: render A2UI without Lit and support web component cat… (#7504) (b3d1aad)
- feat(angular): render A2UI with native Angular components (#7418) (6b883bf)
- feat(web-inspector): support targeted notifications in What's New (#6956) (9434edd)
- feat(core): let an app trim the history it sends to a runtime agent (#6926) (93b055e)
- feat(showcase): run the AWS Strands demos on the native interrupt and register the reasoning cells (#6907) (6bc47ae)

### Fixes

- fix(angular): sanitize rendered assistant markdown (#7683) (5acded9)
- fix(opengenui): define the ready-DOM initialization contract (#7662) (d966b88)
- fix(angular): stop chat components restyling unrelated shadow DOM hosts (#7528) (8e3533f)
- fix(core): distinguish Intelligence replay errors from live failures (#7353) (278a78d)
- fix(showcase): gate voice on transcription credentials (#7031) (0cae177)
- fix(angular): publish configured dev agents to the core (#7447) (6e452e5)
- fix(threads-drawer): never lock the drawer on an unresolved entitlement (#7441) (f3961c1)
- fix(angular): wait for the active run before sending and share one co… (#7365) (59c120e)
- fix: restore pending frontend HITL tools after replay (#7271) (5eec9b0)
- fix(react-core,vue,angular): stable chat row keys prevent HITL remount flash (#6152) (86b6f6e)
- fix(release): make GitHub Release notes actually ship (#6830) (d7846ba)

### Other Changes

- chore(deps): bump @ag-ui/\* to 1.0.2 (PNI-551) (#7648) (d4afb51)
- refactor(angular): make effect dependencies explicit via explicitEffect (#6578) (ff43d80)
- refactor(shared): reuse attachment and rich UI event transforms (#7272) (928d051)

### Breaking Changes

- feat(angular)!: render A2UI without Lit and support web component cat… (#7504) (b3d1aad)
