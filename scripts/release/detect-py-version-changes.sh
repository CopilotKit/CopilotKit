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
# Capture curl stderr so transport errors (DNS/TLS/connection refused) surface to
# the operator instead of being erased into a vague "HTTP 000".
RESP="$(mktemp)"; CURL_ERR="$(mktemp)"; trap 'rm -f "$RESP" "$CURL_ERR"' EXIT
CODE="$(curl -sS --max-time 30 --retry 3 --retry-all-errors --retry-connrefused -o "$RESP" -w '%{http_code}' "${PYPI_BASE_URL}/pypi/${NAME}/json" 2>"$CURL_ERR" || echo "000")"
case "$CODE" in
  200)
    # Compute the MAX numeric-parseable version from the `releases` dict (the
    # complete set of released versions). `info.version` is the LATEST-UPLOADED,
    # not necessarily the highest — out-of-order patch uploads to an old line
    # can produce info.version < max(releases). Non-numeric keys (prereleases
    # like "0.2.0rc1", dev/post tags) are filtered out, not aborted on.
    #
    # Exclude fully-yanked releases: each release maps to a list of file dicts
    # with a "yanked" bool. A version with an empty file list or all files
    # yanked is NOT a live release and must be skipped — otherwise a yanked
    # bogus high version (e.g. 0.99.0) permanently blocks legitimate bumps.
    #
    # If a 200 response lacks a "releases" key, FAIL LOUD: that's not a "new
    # package" signal (only 404 is), it's malformed/unexpected JSON for a
    # publish gate. If no live numeric release exists, treat as NEW.
    PUBLISHED="$(python3 - "$RESP" <<'PY'
import sys, json, re
with open(sys.argv[1]) as f:
    data = json.load(f)
if not isinstance(data, dict) or "releases" not in data or data.get("releases") is None:
    sys.exit("missing or null 'releases' key in PyPI JSON response")
releases = data["releases"]
numeric = []
for k, files in releases.items():
    if not re.fullmatch(r"\d+(\.\d+)*", k):
        continue
    # Live iff at least one non-yanked file exists. Empty list -> excluded.
    if isinstance(files, list) and any(not f.get("yanked", False) for f in files):
        numeric.append(k)
if not numeric:
    print("")
else:
    best = max(numeric, key=lambda v: tuple(int(x) for x in v.split(".")))
    print(best)
PY
)" || { echo "ERROR: bad JSON from PyPI (or missing releases key)" >&2; exit 1; }
    if [ -z "$PUBLISHED" ]; then
      echo "Published: ${NAME} has no live numeric releases — treating as NEW" >&2
    else
      echo "Published: ${NAME}==${PUBLISHED}" >&2
    fi ;;
  404)
    PUBLISHED=""; echo "Not found on PyPI — treating as NEW" >&2 ;;
  000)
    echo "ERROR: curl transport/connection failure contacting ${PYPI_BASE_URL}/pypi/${NAME}/json (HTTP 000 = no response, not an HTTP status)" >&2
    if [ -s "$CURL_ERR" ]; then
      echo "--- curl stderr ---" >&2; cat "$CURL_ERR" >&2; echo "--- end curl stderr ---" >&2
    fi
    exit 1 ;;
  *)
    echo "ERROR: unexpected HTTP ${CODE} from ${PYPI_BASE_URL}/pypi/${NAME}/json" >&2
    if [ -s "$CURL_ERR" ]; then
      echo "--- curl stderr ---" >&2; cat "$CURL_ERR" >&2; echo "--- end curl stderr ---" >&2
    fi
    exit 1 ;;
esac

if [ -z "$PUBLISHED" ]; then
  SHOULD_PUBLISH="true"
else
  # Plain X.Y.Z numeric-tuple comparison (no third-party deps). The stable lane
  # only ships dotted-numeric LOCAL versions; refuse non-numeric LOCAL loudly.
  # PUBLISHED is already guaranteed numeric (filtered above when computing max).
  # Zero-pad the shorter tuple before comparing so "0.2" and "0.2.0" compare
  # equal (PEP 440). Without padding, (0,2,0) > (0,2) wrongly yields True and
  # triggers a duplicate-version `uv publish` that PyPI rejects with 400.
  SHOULD_PUBLISH="$(python3 - "$VERSION" "$PUBLISHED" <<'PY'
import sys, re
def parse_local(v):
    if not re.fullmatch(r"\d+(\.\d+)*", v):
        sys.exit(f"non-numeric local version not supported on stable lane: {v!r}")
    return tuple(int(x) for x in v.split("."))
local = parse_local(sys.argv[1])
pub = tuple(int(x) for x in sys.argv[2].split("."))
n = max(len(local), len(pub))
local += (0,) * (n - len(local))
pub += (0,) * (n - len(pub))
print("true" if local > pub else "false")
PY
)" || exit 1
fi

echo "should_publish=${SHOULD_PUBLISH}" >&2
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "should_publish=${SHOULD_PUBLISH}"; echo "name=${NAME}"; echo "version=${VERSION}"; } >> "$GITHUB_OUTPUT"
fi
echo "${SHOULD_PUBLISH} ${NAME} ${VERSION}"
