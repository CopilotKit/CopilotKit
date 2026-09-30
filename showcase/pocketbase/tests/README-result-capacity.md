# Complete result capacity regression

Run this real PocketBase 0.22.21 proof against locally built official images. The
driver creates uniquely named private containers and disposable volumes, binds
only to loopback on automatically assigned ports, and bootstraps a test-only
admin. It never accepts an external database URL or existing volume.

Build the baseline from a checkout before the capacity migration, and the
candidate from this checkout. Run commands from the candidate repository root
through Nx; Dockerfile, context, and test paths must be absolute because Nx
executes this project from `showcase/scripts`.

```sh
REPO_ROOT="$(git rev-parse --show-toplevel)"
BASELINE_ROOT=/absolute/path/to/pre-capacity-checkout
NX_DAEMON=false NX_TUI=false pnpm exec nx exec \
  --projects=@copilotkit/showcase-scripts -- \
  docker build -f "$BASELINE_ROOT/showcase/pocketbase/Dockerfile" \
  -t showcase-pocketbase:capacity-baseline "$BASELINE_ROOT/showcase/pocketbase"
NX_DAEMON=false NX_TUI=false pnpm exec nx exec \
  --projects=@copilotkit/showcase-scripts -- \
  docker build -f "$REPO_ROOT/showcase/pocketbase/Dockerfile" \
  -t showcase-pocketbase:capacity-candidate "$REPO_ROOT/showcase/pocketbase"
PB_TEST_BASELINE_IMAGE=showcase-pocketbase:capacity-baseline \
PB_TEST_CANDIDATE_IMAGE=showcase-pocketbase:capacity-candidate \
NX_DAEMON=false NX_TUI=false pnpm exec nx exec \
  --projects=@copilotkit/showcase-scripts -- \
  node "$REPO_ROOT/showcase/pocketbase/tests/result-capacity.integration.mjs"
```

Docker uses the current context. Set `PB_TEST_DOCKER_CONTEXT` to choose another;
use that same context for both builds. For an intentionally failing baseline
run, set `PB_TEST_MODE=legacy`: a complete result over 64 KiB returns HTTP 400
where the persistence assertion expects HTTP 200. No candidate image is needed
for this RED run.

The ordinary suite verifies baseline rejection, then upgrades the **same
volume, row, and complete payload**. It checks preserved legacy row data and
unrelated schema, a finite 2,000,000-byte cap, full result readback equality and
canonical UTF-8 JSON hashes, rejected overflow without mutation, and a fresh
candidate volume. The deterministic 42-cell fixture includes every verdict and
proof field; it is a regression fixture, not a captured framework probe. Set
`PB_TEST_RESULT_FILE` to an absolute JSON capture path to test your own complete
payload between 65,536 and 2,000,000 canonical UTF-8 bytes.

Additional private databases prove that an existing 3,000,000-byte field and
result over 2 MiB are preserved, and that missing or non-JSON result fields fail
startup loudly without schema/data mutation. These malformed subjects are
prepared by test-only migrations mounted into their private baseline containers;
they are absent from the production image. PocketBase 0.22.21 may exit zero
after a migration error, so the guard checks require the specific migration
error and a stopped server rather than relying on the CLI exit code. To exercise
idempotence, the
driver copies the image's exact migration into a private migration directory
under a second filename and executes its up callback again. Application-image
rollback and re-upgrade retain capacity and complete results. **The driver
never executes a down migration.**

Containers, volumes, and temporary migration copies are removed after each run.
For inspectable local evidence, create a directory and set
`PB_TEST_EVIDENCE_DIR` to its absolute path; it receives RED/GREEN receipts and
server logs. Set `PB_TEST_KEEP_ARTIFACTS=1` to retain stopped test containers and
volumes; the driver prints their unique names for later inspection and cleanup.
