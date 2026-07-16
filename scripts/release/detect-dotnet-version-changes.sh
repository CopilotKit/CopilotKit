#!/usr/bin/env bash
# Detect whether the checked-in CopilotKit.Intelligence version is absent from
# NuGet.org. Emits GitHub Actions outputs: should_publish, name, version.
set -euo pipefail

CSPROJ="${CSPROJ_PATH:-sdk-dotnet/CopilotKit.Intelligence/CopilotKit.Intelligence.csproj}"
NUGET_FLAT_CONTAINER_URL="${NUGET_FLAT_CONTAINER_URL:-https://api.nuget.org/v3-flatcontainer}"

PROJECT_METADATA="$(python3 - "$CSPROJ" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()

def first_text(name):
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] == name and element.text:
            value = element.text.strip()
            if value:
                return value
    return None

package_id = first_text("PackageId")
version = first_text("Version")
if package_id != "CopilotKit.Intelligence":
    raise SystemExit(f"PackageId must be exactly 'CopilotKit.Intelligence', got {package_id!r}")
if version is None or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
    raise SystemExit(f"Version must be an explicit NuGet-compatible SemVer value, got {version!r}")
print(package_id)
print(version)
PY
)" || {
  echo "ERROR: failed to parse package identity/version from ${CSPROJ}" >&2
  exit 1
}

NAME="$(printf '%s\n' "$PROJECT_METADATA" | sed -n '1p')"
VERSION="$(printf '%s\n' "$PROJECT_METADATA" | sed -n '2p')"
LOWER_NAME="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')"
REGISTRY_URL="${NUGET_FLAT_CONTAINER_URL%/}/${LOWER_NAME}/index.json"
echo "Local: ${NAME} ${VERSION}" >&2

RESPONSE="$(mktemp)"
CURL_ERROR="$(mktemp)"
trap 'rm -f "$RESPONSE" "$CURL_ERROR"' EXIT
if ! HTTP_CODE="$(curl -sS --max-time 30 --retry 3 --retry-all-errors --retry-connrefused \
  -o "$RESPONSE" -w '%{http_code}' "$REGISTRY_URL" 2>"$CURL_ERROR")"; then
  HTTP_CODE="000"
fi

case "$HTTP_CODE" in
  200)
    SHOULD_PUBLISH="$(python3 - "$RESPONSE" "$VERSION" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as response_file:
    payload = json.load(response_file)
versions = payload.get("versions") if isinstance(payload, dict) else None
if not isinstance(versions, list) or not versions or not all(isinstance(item, str) and item for item in versions):
    raise SystemExit("expected a non-empty string array at 'versions'")
local_version = sys.argv[2].lower()
print("false" if local_version in {item.lower() for item in versions} else "true")
PY
)" || {
      echo "ERROR: malformed NuGet registry response from ${REGISTRY_URL}" >&2
      exit 1
    }
    ;;
  404)
    SHOULD_PUBLISH="true"
    echo "Package not found on NuGet — treating as new" >&2
    ;;
  000)
    echo "ERROR: transport failure contacting ${REGISTRY_URL}" >&2
    if [ -s "$CURL_ERROR" ]; then cat "$CURL_ERROR" >&2; fi
    exit 1
    ;;
  *)
    echo "ERROR: unexpected HTTP ${HTTP_CODE} from ${REGISTRY_URL}" >&2
    if [ -s "$CURL_ERROR" ]; then cat "$CURL_ERROR" >&2; fi
    exit 1
    ;;
esac

echo "should_publish=${SHOULD_PUBLISH}" >&2
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "should_publish=${SHOULD_PUBLISH}"
    echo "name=${NAME}"
    echo "version=${VERSION}"
  } >> "$GITHUB_OUTPUT"
fi
echo "${SHOULD_PUBLISH} ${NAME} ${VERSION}"
