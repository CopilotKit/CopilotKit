# Intelligence smoke test

Run the candidate CopilotKit SDK against a disposable local Intelligence stack.
The test uses real Thread storage and Learning jobs, with fixed model replies.
A successful run requires saved output, valid transcript citations, and every expected model phase.

## Run locally

Use Docker with a running daemon, Node.js 24, pnpm, k3d, Helm, Git, and tar.
The CI workflow pins Node.js 24.18.0, k3d 5.8.3, and Helm 3.17.3.
Package installation and public image downloads require network access.
No cloud model key, registry login, or production credential is required.

From the repository root:

```sh
pnpm install --filter @copilotkit/runtime... --filter CopilotKit --frozen-lockfile --ignore-scripts
pnpm nx run intelligence-smoke:test
pnpm nx run intelligence-smoke:run -- --k3d=/path/to/k3d --output=/tmp/intelligence-smoke-results
```

Choose an output directory that does not exist.
Omit `--k3d` to use the executable on `PATH`.
Use `--helm=/path/to/helm` to select another Helm executable.
Without `--output`, the runner creates a unique `smoke-results-*` directory in the current directory.

To exercise the failure path, use a new output directory and an incorrect expected reply:

```sh
pnpm nx run intelligence-smoke:run -- --output=/tmp/intelligence-smoke-negative --expect-reply=BROKEN
```

This command must exit with a nonzero status.
The model still returns the fixed reply, so the Thread proof cannot pass.

## Candidate Intelligence source

The default run uses the public images in [pins.json](./pins.json).
To build Intelligence services from a local checkout:

```sh
pnpm nx run intelligence-smoke:run -- --intelligence-source=/path/to/intelligence --output=/tmp/intelligence-smoke-candidate
```

The checkout must have clean tracked files.
The runner builds app-api, realtime-gateway, and migrations from Git archives of its exact `HEAD` commit.
Untracked files do not enter these build contexts.
The runner imports the images into the k3d node with `ctr` and compares imported manifests with the built image identities.
It does not use `k3d image import`, which can report success before the import has run.
The chart and supporting services still use the public pins.

## What the runner does

1. Build the runtime and install packed workspace packages into an isolated consumer.
2. Compare the installed runtime hash with the candidate build and record package archive hashes.
3. Start AIMock and a unique k3d cluster with generated local credentials.
4. Install the pinned chart, run its migration and bootstrap hooks, and start the services.
5. Exercise Thread and Learning, save evidence, and remove the owned cluster and temporary files.

On SIGINT or SIGTERM, the runner stops active commands and completes cleanup before it exits with a nonzero status.
Repeated signals do not stop cleanup commands, which retain their time limits.

The built SDK runs in a separate process.
It sends a real agent run through the Intelligence gateway and reads the saved conversation through app-api.
Learning binds that Thread, waits for harvest, starts a run, and reads the saved Insights twice.
The proof requires nonempty output with the complete fixture citation list bound to the saved snapshot.
Missing, duplicated, or unrelated citations fail the proof.
Both reads must produce the same digest.

AIMock serves only the checked-in replies in [fixtures.json](./fixtures.json).
It listens on `0.0.0.0` so the Docker stack can reach it on Linux and Docker Desktop.
Other hosts can reach this temporary port if the host firewall permits it.
Run the test on an isolated CI runner or a trusted local network.
The server never forwards requests to a model provider.
Unknown, missing, repeated, or out-of-order model phases fail the result.
The transcript fixture requires the expected conversation.
The SDK model client rejects requests to another origin.

## Read the artifacts

| Artifact                | Contents                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `result.json`           | Overall status, error, SDK hashes, proof results, and stack evidence                                             |
| `proof.json`            | Saved Thread messages and Learning output IDs and digest; can contain only Thread evidence after a later failure |
| `model-requests.json`   | Captured model requests and matched phases                                                                       |
| `stack-images.json`     | Requested images, running image identities, and workload status                                                  |
| `candidate-images.json` | Optional Intelligence commit and built/imported image identities                                                 |
| `*.log`                 | Command diagnostics, including hooks, pod logs, events, and cleanup                                              |

Start with `result.json` and the log named in its error.
A partial artifact does not establish a passing run.
Setup failures can prevent later artifacts from existing.
The runner redacts known generated secrets from command logs and omits stdout for private configuration commands.

## CI and proof limits

[The workflow](../../.github/workflows/intelligence-smoke.yml) runs on pull requests and manual dispatch, with read-only repository permissions.
Its default path uses public digest-pinned images and a public digest-pinned chart, without repository secrets.
It also runs the incorrect-reply test and requires that failure to come from the Thread proof.
It uploads both output directories even after failure and retains artifacts for 14 days.
The job has a 45-minute limit.

This test covers one deterministic conversation and its Learning output.
It does not measure model quality, production authentication, the browser interface, scale, or all Learning behavior.
Matching reads establish stable API output during the run; they do not test recovery after a database restart.
The default mode tests candidate SDK code against published Intelligence images.
Only `--intelligence-source` tests locally built Intelligence services.
Unit tests alone do not establish a successful end-to-end run.

## Update the pins

1. Select a compatible public Intelligence release and record its source revision in `pins.json`.
2. Update chart metadata and its manifest digest, plus each changed image digest.
3. Make sure that the chart and images support anonymous downloads and the CI architecture.
4. Run `pnpm nx run intelligence-smoke:test` and `pnpm nx run intelligence-smoke:lint`.
5. Run the full smoke test and the negative reply test with separate output directories; inspect their artifacts.

The chart downloader compares both the manifest and chart layer with their declared SHA-256 digests.
Version labels alone do not change the downloaded chart or images.
Update fixtures only when the intended model contract changes, and preserve their failure tests.
