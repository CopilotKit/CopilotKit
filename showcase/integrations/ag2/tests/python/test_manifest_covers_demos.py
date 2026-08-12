"""Guard against cells that are built on disk but not actually reachable.

Five ag2 cells shipped with a backend, a frontend, an e2e spec and a fixture
yet never appeared on the dashboard, and two of those additionally 404'd
because their frontend pointed at an API route directory that did not exist.
Nothing failed — the cells were simply absent. These tests close that gap.

The dashboard's own rule is `determineCellStatus` in
``showcase/harness/src/shared/catalog/catalog-flatten.ts``: a cell counts as
*wired* only when its id is in the manifest's ``features:`` list AND has a
``demos:`` entry carrying a ``route:``. Declaring one without the other yields
``unshipped`` — invisible, and silently so. That asymmetry is what
:func:`test_routed_demos_are_declared_as_features` pins down.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = INTEGRATION_ROOT / "manifest.yaml"
DEMOS_DIR = INTEGRATION_ROOT / "src" / "app" / "demos"
API_DIR = INTEGRATION_ROOT / "src" / "app" / "api"

# Demo directories deliberately absent from the manifest.
ALLOWED_UNLISTED_DEMOS = {
    # Dev-only round-trip harness; langgraph-python does not list it either.
    "threadid-frontend-tool-roundtrip",
}

# Non-cell entries that live alongside the demo directories.
NOT_A_DEMO_DIR = {"_shared"}


def _manifest() -> dict:
    return yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))


def _demo_entries() -> list[dict]:
    return _manifest().get("demos") or []


def test_every_demo_directory_is_in_the_manifest():
    """A demo directory nobody references is a cell that cannot be reached."""
    on_disk = {
        p.name
        for p in DEMOS_DIR.iterdir()
        if p.is_dir() and p.name not in NOT_A_DEMO_DIR
    }
    routed = {
        entry["route"].removeprefix("/demos/")
        for entry in _demo_entries()
        if entry.get("route", "").startswith("/demos/")
    }
    unlisted = on_disk - routed - ALLOWED_UNLISTED_DEMOS
    assert not unlisted, (
        "demo directories exist but no manifest entry routes to them: "
        f"{sorted(unlisted)}"
    )


def test_every_manifest_route_has_a_directory():
    """The reverse: a manifest route with no page is a 404 on the dashboard."""
    missing = sorted(
        entry["id"]
        for entry in _demo_entries()
        if entry.get("route", "").startswith("/demos/")
        and not (DEMOS_DIR / entry["route"].removeprefix("/demos/")).is_dir()
    )
    assert not missing, f"manifest routes with no demo directory: {missing}"


def test_routed_demos_are_declared_as_features():
    """``demos:`` alone does not ship a cell — ``features:`` is the gate.

    Catches the case that silently un-shipped `tool-rendering-reasoning-chain`:
    it was removed from ``not_supported_features`` but never added to
    ``features``, leaving a fully-built cell in the ``unshipped`` state.
    """
    manifest = _manifest()
    features = set(manifest.get("features") or [])
    not_supported = set(manifest.get("not_supported_features") or [])

    undeclared = sorted(
        entry["id"]
        for entry in _demo_entries()
        if entry.get("route")
        and entry["id"] not in features
        and entry["id"] not in not_supported
    )
    assert not undeclared, (
        "routed demos missing from `features:` — the dashboard renders these "
        f"as 'unshipped' rather than wired: {undeclared}"
    )


def test_features_and_not_supported_do_not_overlap():
    """``validateManifestStructure`` throws on overlap, taking the matrix down."""
    manifest = _manifest()
    overlap = sorted(
        set(manifest.get("features") or [])
        & set(manifest.get("not_supported_features") or [])
    )
    assert not overlap, f"`features` and `not_supported_features` overlap: {overlap}"


def test_every_runtime_url_has_an_api_route():
    """Every ``runtimeUrl`` a page points at must exist under ``src/app/api/``.

    This is the check that would have caught `declarative-hashbrown` and
    `declarative-json-render`: their pages requested
    ``/api/copilotkit-declarative-*`` while the directories on disk were still
    named ``copilotkit-byoc-*``, so both cells 404'd.
    """
    pattern = re.compile(r'runtimeUrl=\{?"(/api/[^"]+)"')
    broken: list[str] = []

    for page in sorted(DEMOS_DIR.rglob("page.tsx")):
        for url in pattern.findall(page.read_text(encoding="utf-8")):
            route_dir = API_DIR / url.removeprefix("/api/")
            if not route_dir.is_dir():
                rel = page.relative_to(INTEGRATION_ROOT)
                broken.append(f"{rel} -> {url} (no such directory)")

    assert not broken, "pages point at API routes that do not exist:\n" + "\n".join(
        broken
    )


def _strip_ts_comments(source: str) -> str:
    """Drop ``//`` and ``/* */`` comments so matches come from code only.

    Without this the check is toothless: a route.ts whose header comment
    mentions the agent id it is *supposed* to register satisfies a plain
    substring search even when the actual key is wrong. Verified by reverting
    the key and watching this test go red.

    Naive w.r.t. ``//`` inside string literals; the only strings that matter
    here are agent ids and `/api/...` paths, and a `//` in those would be
    malformed anyway.
    """
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", source)


def test_literal_agent_ids_are_registered_in_their_runtime():
    """A page's ``agent`` id must be a key in the runtime it posts to.

    A missing key falls through to whatever ``default`` the route declares, so
    the mismatch is invisible until the wrong agent answers — which is how
    `declarative-hashbrown` shipped asking for `declarative-hashbrown-demo`
    from a runtime that only registered `byoc-hashbrown-demo`.

    Only pages whose ``runtimeUrl`` *and* ``agent`` are both string literals
    can be checked; pages passing a constant (``agent={AGENT_ID}``) are
    skipped, so this is a floor rather than a guarantee.
    """
    runtime_pattern = re.compile(r'runtimeUrl=\{?"(/api/[^"]+)"')
    agent_pattern = re.compile(r'agent=\{?"([^"]+)"')
    unregistered: list[str] = []

    for page in sorted(DEMOS_DIR.rglob("page.tsx")):
        source = _strip_ts_comments(page.read_text(encoding="utf-8"))
        runtimes = runtime_pattern.findall(source)
        agents = agent_pattern.findall(source)
        if len(runtimes) != 1 or len(agents) != 1:
            continue

        route_dir = API_DIR / runtimes[0].removeprefix("/api/")
        route_files = list(route_dir.rglob("route.ts")) if route_dir.is_dir() else []
        if not route_files:
            continue  # absence is already reported by the runtimeUrl test

        agent_id = agents[0]
        # The id must appear in the route's *code* in one of the two forms the
        # runtimes actually use. Both are needed, and neither alone is right:
        #   - quoted ("my-agent") — a quoted object key, or an element of a
        #     name array the route loops over (`for (const name of
        #     sharedAgentNames) agents[name] = ...`). Requiring a literal `key:`
        #     would false-fire on every cell registered that way.
        #   - bare identifier key (subagents: "/subagents/") — legal JS when the
        #     id needs no quotes. Requiring quotes would false-fire on those.
        # Comment-stripping is what keeps this honest: a header comment naming
        # the id it is *supposed* to register would otherwise satisfy the check.
        bare_key = re.compile(rf"\b{re.escape(agent_id)}\s*:")
        registered = False
        for route_file in route_files:
            code = _strip_ts_comments(route_file.read_text(encoding="utf-8"))
            if f'"{agent_id}"' in code or bare_key.search(code):
                registered = True
                break

        if not registered:
            rel = page.relative_to(INTEGRATION_ROOT)
            unregistered.append(f'{rel} wants agent "{agent_id}" from {runtimes[0]}')

    assert not unregistered, (
        "pages request agent ids their runtime never registers:\n"
        + "\n".join(unregistered)
    )
