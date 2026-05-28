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
CODE="$(curl -sS -o "$RESP" -w '%{http_code}' "${PYPI_BASE_URL}/pypi/${NAME}/json" 2>/dev/null || echo "000")"
case "$CODE" in
  200)
    PUBLISHED="$(python3 -c 'import sys,json; print(json.load(open(sys.argv[1]))["info"]["version"])' "$RESP")" \
      || { echo "ERROR: bad JSON from PyPI" >&2; exit 1; }
    echo "Published: ${NAME}==${PUBLISHED}" >&2 ;;
  404)
    PUBLISHED=""; echo "Not found on PyPI — treating as NEW" >&2 ;;
  *)
    echo "ERROR: unexpected HTTP ${CODE} from ${PYPI_BASE_URL}/pypi/${NAME}/json" >&2; exit 1 ;;
esac

if [ -z "$PUBLISHED" ]; then
  SHOULD_PUBLISH="true"
else
  # Plain X.Y.Z numeric-tuple comparison (no third-party deps). The stable lane
  # only ships dotted-numeric versions; refuse anything non-numeric loudly.
  SHOULD_PUBLISH="$(python3 - "$VERSION" "$PUBLISHED" <<'PY'
import sys, re
def parse(v):
    if not re.fullmatch(r"\d+(\.\d+)*", v):
        sys.exit(f"non-numeric version not supported on stable lane: {v!r}")
    return tuple(int(x) for x in v.split("."))
local, pub = parse(sys.argv[1]), parse(sys.argv[2])
print("true" if local > pub else "false")
PY
)" || exit 1
fi

echo "should_publish=${SHOULD_PUBLISH}" >&2
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "should_publish=${SHOULD_PUBLISH}"; echo "name=${NAME}"; echo "version=${VERSION}"; } >> "$GITHUB_OUTPUT"
fi
echo "${SHOULD_PUBLISH} ${NAME} ${VERSION}"
