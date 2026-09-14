# Package license checks

`policy.json` records each public npm package and its intended license.
It is independent of the manifest field that the check examines.
Add an entry when you add a public package. Preserve existing third-party licenses.

Run these commands from the repository root:

```sh
pnpm nx run package-licenses:test
pnpm nx run package-licenses:check
pnpm nx run package-licenses:pack
```

The pack target creates real package archives in a temporary directory. It compares
both the packed SPDX field and the full LICENSE file with the policy. It does not
publish packages. Build the CLI first in Intelligence with `CLI_ENV=local pnpm nx build cli`.
Other packages can use this target before a build to check source packaging.
The release paths also check the final built archive immediately before publication.

To check one existing archive:

```sh
node scripts/package-licenses/check.mjs archive /absolute/path/package.tgz <policy-directory>
```

The archive check reads data without extracting or executing package code.
It rejects unknown package names, missing or wrong license fields, missing LICENSE
files, and incomplete or different license text. Existing MIT and Apache-2.0
licenses remain distinct. Commercial packages use UNLICENSED and their own notice.

## Release and tag repair

Publish a new version through the normal release workflow. Check its registry
metadata and download its archive before reporting the release as fixed.
Update supported tags only to verified versions. Record the old and new tag targets.
Do not remove old tags without review. Historical immutable versions can retain
missing metadata even after a corrected release changes the default tag.

A license check does not replace a full dependency or security audit.
