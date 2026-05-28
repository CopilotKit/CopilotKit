#!/usr/bin/env bash
# Detect whether sdk-python/pyproject.toml declares a version newer than what's
# published on PyPI. Emits GitHub Actions outputs: should_publish, name, version.
# Also prints "<should_publish> <name> <version>" to stdout for test consumption.
# PYPI_BASE_URL overridable for tests (default https://pypi.org). Requires py3.11+.
set -euo pipefail

PYPROJECT="${PYPROJECT_PATH:-sdk-python/pyproject.toml}"
PYPI_BASE_URL="${PYPI_BASE_URL:-https://pypi.org}"

# Parse name + version from pyproject (tomllib, py3.11+). Capture explicitly so a
# parse failure aborts (heredoc-fed `read` would otherwise mask it under set -e).
PYOUT="$(python3 - "$PYPROJECT" <<'PY'
import sys, tomllib
with open(sys.argv[1], "rb") as f:
    data = tomllib.load(f)
poetry = data.get("tool", {}).get("poetry", {})
project = data.get("project", {})
name = poetry.get("name") or project.get("name")
version = poetry.get("version") or project.get("version")
if not name or not version:
    sys.exit("could not read name/version from pyproject")
print(name)
print(version)
PY
)" || { echo "ERROR: failed to parse ${PYPROJECT}" >&2; exit 1; }
NAME="$(printf '%s\n' "$PYOUT" | sed -n 1p)"
VERSION="$(printf '%s\n' "$PYOUT" | sed -n 2p)"
echo "Local: ${NAME}==${VERSION}" >&2

# Fetch published version, distinguishing 404 (new package) from other failures.
RESP="$(mktemp)"; trap 'rm -f "$RESP"' EXIT
CODE="$(curl -sS --max-time 30 --retry 3 --retry-connrefused -o "$RESP" -w '%{http_code}' "${PYPI_BASE_URL}/pypi/${NAME}/json" 2>/dev/null || echo "000")"
case "$CODE" in
  200)
    # Compute the MAX numeric-parseable version from the `releases` dict (the
    # complete set of released versions). `info.version` is the LATEST-UPLOADED,
    # not necessarily the highest — out-of-order patch uploads to an old line
    # can produce info.version < max(releases). Non-numeric keys (prereleases
    # like "0.2.0rc1", dev/post tags) are filtered out, not aborted on. If no
    # numeric keys exist, treat as empty (same as 404 -> NEW).
    PUBLISHED="$(python3 - "$RESP" <<'PY'
import sys, json, re
with open(sys.argv[1]) as f:
    data = json.load(f)
releases = data.get("releases") or {}
numeric = []
for k in releases.keys():
    if re.fullmatch(r"\d+(\.\d+)*", k):
        numeric.append(k)
if not numeric:
    print("")
else:
    best = max(numeric, key=lambda v: tuple(int(x) for x in v.split(".")))
    print(best)
PY
)" || { echo "ERROR: bad JSON from PyPI" >&2; exit 1; }
    if [ -z "$PUBLISHED" ]; then
      echo "Published: ${NAME} has no numeric releases — treating as NEW" >&2
    else
      echo "Published: ${NAME}==${PUBLISHED}" >&2
    fi ;;
  404)
    PUBLISHED=""; echo "Not found on PyPI — treating as NEW" >&2 ;;
  *)
    echo "ERROR: unexpected HTTP ${CODE} from ${PYPI_BASE_URL}/pypi/${NAME}/json" >&2; exit 1 ;;
esac

if [ -z "$PUBLISHED" ]; then
  SHOULD_PUBLISH="true"
else
  # Plain X.Y.Z numeric-tuple comparison (no third-party deps). The stable lane
  # only ships dotted-numeric LOCAL versions; refuse non-numeric LOCAL loudly.
  # PUBLISHED is already guaranteed numeric (filtered above when computing max).
  SHOULD_PUBLISH="$(python3 - "$VERSION" "$PUBLISHED" <<'PY'
import sys, re
def parse_local(v):
    if not re.fullmatch(r"\d+(\.\d+)*", v):
        sys.exit(f"non-numeric local version not supported on stable lane: {v!r}")
    return tuple(int(x) for x in v.split("."))
local = parse_local(sys.argv[1])
pub = tuple(int(x) for x in sys.argv[2].split("."))
print("true" if local > pub else "false")
PY
)" || exit 1
fi

echo "should_publish=${SHOULD_PUBLISH}" >&2
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "should_publish=${SHOULD_PUBLISH}"; echo "name=${NAME}"; echo "version=${VERSION}"; } >> "$GITHUB_OUTPUT"
fi
echo "${SHOULD_PUBLISH} ${NAME} ${VERSION}"
