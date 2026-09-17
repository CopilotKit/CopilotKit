#!/usr/bin/env bash
#
# Install one starter from a clean state and prove its code imports.
#
# WHY (PE-140)
# ------------
# Nothing used to install the starters under examples/integrations/. The
# lefthook pre-commit hook tests packages/** only, and the starters are not
# pnpm workspace members and have no nx targets. test_smoke-starter.yml builds
# fourteen of the twenty-two in docker; this script covers the rest, which is
# where both known breakages lived (PE-129 a2a-middleware, PE-38
# claude-sdk-python).
#
# DEPTH — install and import, not end-to-end. PE-129 would have been caught by
# importing the agents' modules; a full e2e across the fleet would be slow and
# is not what either defect needed.
#
# OUTPUT — every failure names the starter and the manifest, so triage does not
# begin with a stack trace.
#
# Usage: .github/scripts/starter-clean-install.sh <starter-slug>

set -uo pipefail

STARTER="${1:?usage: starter-clean-install.sh <starter-slug>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="$REPO_ROOT/examples/integrations/$STARTER"

[ -d "$DIR" ] || { echo "::error::no such starter: examples/integrations/$STARTER"; exit 1; }

FAILURES=0
KNOWN_BROKEN_FILE="$REPO_ROOT/.github/scripts/starter-clean-install-known-broken.txt"

# A starter listed in starter-clean-install-known-broken.txt was ALREADY broken
# when this check landed. It is reported as a warning instead of a failure, so
# the lane is green on day one and a NEW breakage is unambiguous. Each line
# names the ticket that owns the fix; the file only ever shrinks.
is_known_broken() {
  local rel="$1"
  [ -f "$KNOWN_BROKEN_FILE" ] || return 1
  grep -v '^[[:space:]]*#' "$KNOWN_BROKEN_FILE" \
    | grep -v '^[[:space:]]*$' \
    | cut -d'|' -f1,2 \
    | grep -qxF "$STARTER|$rel"
}

fail() {
  local manifest="$1" problem="$2"
  local rel="examples/integrations/${manifest#"$REPO_ROOT/examples/integrations/"}"
  echo ""
  if is_known_broken "$rel"; then
    echo "::warning::starter \"$STARTER\" is a KNOWN broken starter (see .github/scripts/starter-clean-install-known-broken.txt)"
    echo "  starter:  $STARTER"
    echo "  manifest: $rel"
    echo "  problem:  $problem"
    echo ""
    return
  fi
  echo "::error::starter \"$STARTER\" failed a clean install"
  echo "  starter:  $STARTER"
  echo "  manifest: $rel"
  echo "  problem:  $problem"
  echo ""
  FAILURES=$((FAILURES + 1))
}

step() { echo "--- [$STARTER] $*"; }

# ---------------------------------------------------------------------------
# Node half: install from the committed lockfile, then build.
#
# --ignore-scripts on purpose: several starters run their Python agent setup
# from a postinstall hook, and a failure in there would be reported as an npm
# error with no manifest attached. The Python half below does that work itself
# and names the manifest when it breaks.
# ---------------------------------------------------------------------------
if [ -f "$DIR/package.json" ]; then
  step "npm install"
  if [ -f "$DIR/package-lock.json" ]; then
    NPM_CMD=(npm ci --ignore-scripts --no-audit --no-fund)
  else
    NPM_CMD=(npm install --ignore-scripts --no-audit --no-fund)
  fi
  if ! (cd "$DIR" && "${NPM_CMD[@]}"); then
    fail "$DIR/package.json" "${NPM_CMD[*]} failed — the starter's npm dependencies do not install from a clean state."
  else
    if node -e 'process.exit(require(process.argv[1]).scripts?.build ? 0 : 1)' "$DIR/package.json"; then
      step "npm run build"
      if ! (cd "$DIR" && npm run build); then
        fail "$DIR/package.json" "\`npm run build\` failed after a clean install."
      fi
    else
      step "no build script, install-only"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Python half: install each agent's declared dependencies, then import every
# module the starter ships next to that manifest.
# ---------------------------------------------------------------------------
PY_MANIFESTS=$(
  find "$DIR" -maxdepth 3 \( -name requirements.txt -o -name pyproject.toml \) \
    -not -path "*/node_modules/*" -not -path "*/.venv/*" | sort
)

# `uv sync` puts its environment wherever the project says, which for a
# workspace member is the workspace root rather than anywhere this script
# chooses. Note what already existed so the cleanup at the end removes only
# what this run created and never a developer's own environment.
PRE_EXISTING_VENVS=$(find "$DIR" -maxdepth 4 -name .venv -type d 2>/dev/null | sort)

for MANIFEST in $PY_MANIFESTS; do
  MDIR="$(dirname "$MANIFEST")"
  REL="${MANIFEST#"$REPO_ROOT/"}"

  # A uv workspace root only points at its members, which are visited in their
  # own right. Installing it would be a no-op at best.
  if [ "$(basename "$MANIFEST")" = "pyproject.toml" ] && grep -q '^\[tool\.uv\.workspace\]' "$MANIFEST"; then
    step "skip $REL (uv workspace root; members are checked individually)"
    continue
  fi

  step "python install: $REL"
  INSTALLED=0
  VENV=""
  PYRUN=()

  if [ -f "$MDIR/uv.lock" ] && command -v uv >/dev/null 2>&1; then
    # A committed uv.lock is what a developer actually resolves, so reproduce
    # that rather than a free resolution. uv manages its own environment (at
    # the workspace root for a workspace member), so do not hand it one.
    if (cd "$MDIR" && uv sync --frozen --no-progress); then
      INSTALLED=1
      PYRUN=(uv run --frozen --no-progress python)
    fi
  else
    VENV="$MDIR/.venv-clean-install"
    rm -rf "$VENV"
    if ! python3 -m venv "$VENV"; then
      fail "$MANIFEST" "could not create a virtualenv for this agent."
      continue
    fi
    PYRUN=("$VENV/bin/python")
    "${PYRUN[@]}" -m pip install --quiet --upgrade pip >/dev/null 2>&1

    if [ "$(basename "$MANIFEST")" = "requirements.txt" ]; then
      if "${PYRUN[@]}" -m pip install --quiet -r "$MANIFEST"; then INSTALLED=1; fi
    else
      # No lock: install exactly what [project].dependencies declares.
      # Installing the project itself would drag in its build backend and
      # report backend errors as dependency errors.
      # Read into an array rather than piping to xargs: a requirement with
      # extras can contain a space (`ag-ui-agent-spec[langgraph, wayflow]`),
      # which xargs would split into two nonsense arguments.
      DEPS=()
      while IFS= read -r spec; do
        [ -n "$spec" ] && DEPS+=("$spec")
      done < <(node "$REPO_ROOT/.github/scripts/print-pyproject-deps.mjs" "$MANIFEST")

      if [ "${#DEPS[@]}" -eq 0 ]; then
        step "no [project] dependencies in $REL"
        INSTALLED=1
      elif "${PYRUN[@]}" -m pip install --quiet "${DEPS[@]}"; then
        INSTALLED=1
      fi
    fi
  fi

  if [ "$INSTALLED" -ne 1 ]; then
    fail "$MANIFEST" "the declared Python dependencies do not install from a clean state."
    [ -n "$VENV" ] && rm -rf "$VENV"
    continue
  fi

  # Import every module the starter ships beside this manifest. This is the
  # step that would have caught PE-129: pip exited 0 there, and the agents only
  # died when something imported `a2a.server.apps`.
  # `__init__` / `__main__` are not importable by name from outside their
  # package — importing them directly raises on the package's own relative
  # imports and says nothing about the installed dependencies.
  MODULES=$(find "$MDIR" -maxdepth 1 -name '*.py' -exec basename {} .py \; \
    | grep -vx -e '__init__' -e '__main__' | sort)
  SRC_PKGS=""
  if [ -d "$MDIR/src" ]; then
    SRC_PKGS=$(find "$MDIR/src" -maxdepth 2 -name '__init__.py' -exec dirname {} \; \
      | sed 's|.*/||' | sort -u)
  fi

  if [ -z "$MODULES" ] && [ -z "$SRC_PKGS" ]; then
    step "installed; no importable module beside $REL"
  fi

  # Agents commonly sit in `agents/<name>/` and import shared helpers from
  # `agents/` (agentcore's `from utils.auth import ...`), which their Dockerfile
  # puts on the path. Include the parent when it is still inside the starter,
  # so a layout like that is not reported as a broken dependency.
  PY_PATH="$MDIR:$MDIR/src"
  PARENT="$(dirname "$MDIR")"
  case "$PARENT" in "$DIR"|"$DIR"/*) PY_PATH="$PY_PATH:$PARENT" ;; esac

  # Only an ImportError counts. Agent modules routinely read a required
  # environment variable or build a client at module scope, and failing on that
  # would make this check a source of false reds rather than a signal. If the
  # module got far enough to raise something else, every import it needed
  # resolved, which is the whole question being asked here.
  IMPORT_DRIVER='
import importlib, sys, traceback
mod = sys.argv[1]
try:
    importlib.import_module(mod)
except ImportError:
    traceback.print_exc()
    sys.exit(1)
except BaseException as exc:
    print(f"note: {mod} resolved all of its imports, then stopped at module scope "
          f"on {type(exc).__name__}: {exc}. Not a dependency problem.")
'

  for MOD in $MODULES $SRC_PKGS; do
    if ! (cd "$MDIR" && PYTHONPATH="$PY_PATH" "${PYRUN[@]}" -c "$IMPORT_DRIVER" "$MOD"); then
      fail "$MANIFEST" "\`import $MOD\` raised ImportError after a clean install — the installed versions do not provide what the code imports."
    fi
  done

  [ -n "$VENV" ] && rm -rf "$VENV"
done

comm -13 <(printf '%s\n' "$PRE_EXISTING_VENVS") \
  <(find "$DIR" -maxdepth 4 -name .venv -type d 2>/dev/null | sort) \
  | while read -r created; do [ -n "$created" ] && rm -rf "$created"; done

if [ "$FAILURES" -gt 0 ]; then
  echo "::error::starter \"$STARTER\": $FAILURES clean-install failure(s) — see the manifest named above."
  exit 1
fi

echo "[$STARTER] clean install OK"
