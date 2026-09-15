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
