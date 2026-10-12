# Compatibility audit operator guide

The manual command reads mapped Showcase dependency files from one committed
`origin/main` tree, queries npm, PyPI, NuGet and Maven, and writes one readable
JSON report. It does not run during dashboard page loads, tests, installs or
builds. Run from the repository root with Node 22 and workspace dependencies.
Fetch main first so the local remote-tracking ref is current:

```sh
git fetch origin main
collector_dashboard=/absolute/path/to/repo/showcase/shell-dashboard
NX_DAEMON=false NX_TUI=false pnpm exec nx exec --projects=@copilotkit/showcase-scripts -- npm --prefix "$collector_dashboard" run compatibility:audit -- --out /absolute/path/to/new-audit.json
```

`--out` must be an absolute path to a new report file. The command refuses to
replace an existing file. The default `asOf` cutoff is the run's UTC time. To
choose an explicit release cutoff, add `--as-of 2026-09-30T15:00:00Z`.
The collector resolves `refs/remotes/origin/main` to one full commit SHA,
validates the mapping against that commit's manifest roster, then reads only
the mapped dependency and lock files from its tree. It never reads dependency
facts from the working tree.

Exact Python requirements pins, satisfying npm root lock resolutions, literal
NuGet references and resolvable Spring POM properties are
prototype source facts. They do not prove which version a deployed container
installed.
Ranges, ambiguous declarations and unresolved transitive dependencies remain
unknown. Every required mapped package contributes to the assessment even
when unknown; that makes its variant Not verified. Adapters, provider clients
and other excluded packages are explained in `mapping.ts`.

Both .NET variants require core (`Microsoft.Agents.AI`); the Harness variant
also scores `Microsoft.Agents.AI.Harness` from its direct project declaration.
Core is transitive in both applications, so its version remains unknown and
both variants remain Not verified. Hosting and AGUI packages appear only in
report exclusions, outside generated dashboard package rows.

The audit observes existing dependency declarations and evidence. It does not
change integration dependencies, generate lockfiles, or alter restore settings
to improve verification coverage. Dependency pinning belongs in a separate
change; missing version evidence remains an explicit unknown.

The report records the source SHA and label, cutoff, response URL/status/time,
mapped package facts and source paths, selected latest release with its
timestamp kind, full Microsoft preview trains where applicable, scores,
reasons, exclusions and the proposed snapshot. It contains no raw registry
bodies or replay archive. Response observation time and the release cutoff
are separate. Maven Central Search timestamps remain labeled
`registry-last-updated`, not publication instants.

Review the report before changing the checked-in snapshot. Only an explicit
`--write-snapshot` replaces it, after a complete assessment and successful
report write:

```sh
NX_DAEMON=false NX_TUI=false pnpm exec nx exec --projects=@copilotkit/showcase-scripts -- npm --prefix "$collector_dashboard" run compatibility:audit -- --out /absolute/path/to/new-audit.json --write-snapshot
```

If any mapped registry inventory is incomplete, the command fails without
writing the report or replacing the snapshot. Registry state can change after
the run, so the report describes that run rather than serving as a replay
input. When a Showcase manifest is added or removed, update `mapping.ts`
with its framework libraries or an explicit exclusion reason. The pinned
manifest roster check rejects missing and stale mappings.

The existing scorer selects the latest eligible stable release at the cutoff,
with dated Microsoft preview policy only for approved Agent Framework
mappings. It receives every eligible preview train without truncation.
The Google ADK framework remains unpinned even though its adapter is pinned
([lock issue](https://github.com/CopilotKit/CopilotKit/issues/7284)); AG2
still has its `>=0.9.0,<1.0.0` range
([lock issue](https://github.com/CopilotKit/CopilotKit/issues/7285)).
This audit changes neither dependency.

Registry contracts: [npm package metadata](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md),
[PyPI Index API](https://docs.pypi.org/api/index-api/),
[NuGet registration](https://learn.microsoft.com/en-us/nuget/api/registration-base-url-resource),
and [Maven repository metadata](https://maven.apache.org/ref/3-LATEST/maven-repository-metadata/repository-metadata.html).
