"""The declarative-gen-ui cell must be driven by ag2's own A2UI stack.

Guards the two failure modes that made the previous wiring fragile:

1. The Python tool body was a stub that only raised — all real work happened in
   the CopilotKit JS middleware, so the cell exercised none of ag2's A2UI code.
2. A ``catalogId`` the frontend has not registered renders as "Catalog not
   found", and a component tree that fails schema validation degrades silently
   to plain prose. Both surface as a RED cell with no obvious cause, so they are
   checked mechanically here rather than by inspection.
"""

import inspect
import json
import os
import re

from ag2.a2ui.constants import A2UI_JSON_CLOSE_TAG, A2UI_JSON_OPEN_TAG
from ag2.a2ui.parser import A2UIResponseParser
from ag2.a2ui.schema_manager import A2UISchemaManager

from agents import a2ui_dynamic

_HERE = os.path.dirname(__file__)
_PKG_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
_DEFINITIONS_TS = os.path.join(
    _PKG_ROOT, "src", "app", "demos", "declarative-gen-ui", "a2ui", "definitions.ts"
)
_FIXTURE = os.path.abspath(
    os.path.join(_PKG_ROOT, "..", "..", "aimock", "d6", "ag2", "gen-ui-declarative.json")
)


def test_no_raising_stub():
    src = inspect.getsource(a2ui_dynamic)
    assert "raise RuntimeError" not in src, "the tool stub that only raises must be gone"


def test_uses_ag2_a2ui_server():
    src = inspect.getsource(a2ui_dynamic)
    assert "A2UIServer" in src
    assert "AgUiTransport" in src


def test_no_private_ag2_imports():
    assert "_types" not in inspect.getsource(a2ui_dynamic)


def test_catalog_id_matches_the_frontend():
    """The emitted catalogId must equal the catalog the page registers, or the
    renderer reports "Catalog not found"."""
    assert a2ui_dynamic.CATALOG.get("$id") == "declarative-gen-ui-catalog"


def test_catalog_components_match_definitions_ts():
    """The server catalog and the frontend's Zod definitions are hand-synced
    (two files, two languages). Names drifting apart is the likeliest break, so
    assert the sets are equal rather than trusting a comment."""
    with open(_DEFINITIONS_TS, encoding="utf-8") as fh:
        definitions_src = fh.read()
    # Top-level keys of `myDefinitions` are indented exactly two spaces.
    frontend = set(re.findall(r"^  (\w+): \{$", definitions_src, re.MULTILINE))
    assert frontend, "failed to parse component names out of definitions.ts"
    assert frontend == set(a2ui_dynamic.CATALOG["components"])


def _parser() -> A2UIResponseParser:
    """The exact validator ``A2UIServer`` builds (see ag2's ``_A2UIRuntime``)."""
    manager = A2UISchemaManager(
        protocol_version="v0.9", custom_catalog=a2ui_dynamic.CATALOG
    )
    return A2UIResponseParser(
        version_string=manager.version_string,
        server_to_client_schema=manager.server_to_client_schema,
        schema_registry=manager.build_schema_registry(),
        component_schemas=manager.get_component_schemas(),
        catalog_id=manager.catalog_id,
    )


def test_validation_is_not_vacuous():
    """A tree the frontend could not render must actually fail — otherwise the
    fixture test below would pass for the wrong reason."""
    result = _parser().validate(
        [{"version": "v0.9", "updateComponents": {"surfaceId": "s", "components": [
            {"id": "root", "component": "Sparkline"},
        ]}}]
    )
    assert not result.is_valid


def test_fixture_trees_validate_against_the_catalog():
    """Every ``<a2ui-json>`` block in the cell's fixture must validate.

    On repeated validation failure the transport drops the surface and returns
    prose only — a RED cell whose cause is invisible from the frontend.
    """
    with open(_FIXTURE, encoding="utf-8") as fh:
        fixture = json.load(fh)

    parser = _parser()
    blocks = 0
    for entry in fixture["fixtures"]:
        content = entry.get("response", {}).get("content", "")
        if A2UI_JSON_OPEN_TAG not in content:
            continue
        blocks += 1
        parsed = parser.parse(content)
        assert parsed.parse_error is None, parsed.parse_error
        assert parsed.operations, "an <a2ui-json> block yielded no operations"
        # Prose must survive outside the block — the cell shows a chat reply too.
        assert parsed.text
        assert A2UI_JSON_CLOSE_TAG not in parsed.text
        result = parser.validate(parsed.operations)
        assert result.is_valid, (
            f"{entry['match'].get('userMessage')!r}: {result.errors}"
        )
        surfaces = [
            op["createSurface"]["catalogId"] for op in parsed.operations if "createSurface" in op
        ]
        assert surfaces == ["declarative-gen-ui-catalog"], surfaces

    assert blocks == 4, f"expected one A2UI response per demo pill, found {blocks}"
