#!/usr/bin/env python3
"""codegen_cvdiag_schema.py — generate ``cvdiag_schema.py`` (Pydantic v2 models)
from the canonical JSON Schema ``showcase/harness/src/cvdiag/schema.json``.

The Python data-plane models are CODE-GENERATED (never hand-written) so they
stay byte-for-byte in lockstep with the cross-language schema that L0-A owns.
``schema.json`` is the single intermediate representation consumed here, by the
.NET binding (L0-D), the Java binding (L0-E), and the TS binding (L0-F).

Run from the repo root::

    python3 showcase/integrations/_shared/codegen_cvdiag_schema.py          # write
    python3 showcase/integrations/_shared/codegen_cvdiag_schema.py --check   # CI drift check

Plan unit: L0-C.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# ── Path resolution ──────────────────────────────────────────────────────────
# This file lives at showcase/integrations/_shared/codegen_cvdiag_schema.py;
# the schema lives at showcase/harness/src/cvdiag/schema.json. Resolve both
# relative to this file so codegen works from any CWD.
_HERE = Path(__file__).resolve().parent
_REPO_SHOWCASE = _HERE.parent.parent  # → showcase/
_SCHEMA_JSON = _REPO_SHOWCASE / "harness" / "src" / "cvdiag" / "schema.json"
_OUTPUT = _HERE / "cvdiag_schema.py"


def _enum_member_name(value: str) -> str:
    """Map a dotted boundary/enum literal to a PascalCase enum member name.

    ``probe.dom.firsttoken`` → ``PROBE_DOM_FIRSTTOKEN``; ``ok`` → ``OK``.
    Uses SCREAMING_SNAKE so the member set is stable + collision-free.
    """
    return value.replace(".", "_").replace("-", "_").upper()


def _metadata_class_name(boundary: str) -> str:
    """``probe.dom.firsttoken`` → ``MetadataProbeDomFirsttoken``."""
    parts = boundary.replace("-", "_").split(".")
    camel = "".join(p[:1].upper() + p[1:] for p in parts)
    return f"Metadata{camel}"


def build_module(schema: dict) -> str:
    """Render the full ``cvdiag_schema.py`` source from the schema IR."""
    defs = schema["$defs"]
    layers: list[str] = defs["layers"]
    outcomes: list[str] = defs["outcomes"]
    boundaries: list[str] = defs["boundaries"]
    edge_keys: list[str] = defs["edge_header_keys"]
    boundary_meta: dict[str, list[str]] = defs["boundary_metadata_keys"]
    test_id_pattern: str = schema["properties"]["test_id"]["pattern"]
    span_id_pattern: str = schema["properties"]["span_id"]["pattern"]
    slug_pattern: str = schema["properties"]["slug"]["pattern"]
    schema_version: int = schema["schema_version"]

    out: list[str] = []
    a = out.append

    a('"""cvdiag_schema.py — GENERATED Pydantic v2 models for the CVDIAG envelope.')
    a("")
    a("DO NOT EDIT BY HAND. This file is code-generated from")
    a("``showcase/harness/src/cvdiag/schema.json`` by")
    a("``showcase/integrations/_shared/codegen_cvdiag_schema.py``. Re-run that")
    a("script (and commit the result) whenever the schema changes; CI runs the")
    a("generator with ``--check`` to fail on drift. Plan unit: L0-C.")
    a('"""')
    a("")
    a("from __future__ import annotations")
    a("")
    a("from enum import Enum")
    a("from typing import Any, Optional")
    a("")
    a("from pydantic import BaseModel, ConfigDict, Field, model_validator")
    a("")
    a(f"SCHEMA_VERSION = {schema_version}")
    a("")
    a("# UUIDv7 (RFC 9562) pattern for ``test_id`` — version nibble 7, variant 10.")
    a(f"TEST_ID_PATTERN = r{test_id_pattern!r}")
    a(f"SPAN_ID_PATTERN = r{span_id_pattern!r}")
    a(f"SLUG_PATTERN = r{slug_pattern!r}")
    a("")
    a("")

    # ── Enums ────────────────────────────────────────────────────────────────
    a("class CvdiagLayer(str, Enum):")
    a('    """Owning layer of a CVDIAG envelope (spec §5)."""')
    a("")
    for lyr in layers:
        a(f'    {_enum_member_name(lyr)} = "{lyr}"')
    a("")
    a("")

    a("class CvdiagOutcome(str, Enum):")
    a('    """Terminal outcome of a boundary observation (spec §5)."""')
    a("")
    for oc in outcomes:
        a(f'    {_enum_member_name(oc)} = "{oc}"')
    a("")
    a("")

    a("class CvdiagBoundary(str, Enum):")
    a('    """The closed set of 29 data-plane + 4 accounting boundaries (spec §5)."""')
    a("")
    for b in boundaries:
        a(f'    {_enum_member_name(b)} = "{b}"')
    a("")
    a("")

    # ── EdgeHeaders ────────────────────────────────────────────────────────────
    a("class EdgeHeaders(BaseModel):")
    a('    """The closed 9-key edge-header bag (spec §5). Absent → ``None``.')
    a("")
    a("    ``model_config`` forbids extra keys so a forbidden/unknown edge header")
    a("    can never round-trip through this model.")
    a('    """')
    a("")
    a('    model_config = ConfigDict(extra="forbid")')
    a("")
    for key in edge_keys:
        # Header names contain hyphens → use an alias and a sanitized field name.
        field = key.replace("-", "_")
        a(f'    {field}: Optional[str] = Field(default=None, alias="{key}")')
    a("")
    a("")

    # ── Per-boundary metadata models (data-plane boundaries only) ──────────────
    a("# ── Per-boundary metadata models (one per data-plane boundary, spec §5) ──")
    a("# Each forbids extra keys so an unknown metadata key is surfaced (caller")
    a("# stamps ``_metadata_dropped`` on the envelope).")
    a("")
    metadata_class_map: list[tuple[str, str]] = []
    for boundary in boundaries:
        keys = boundary_meta.get(boundary)
        if keys is None:
            # Accounting (cvdiag.*) boundaries carry a free-form metadata bag.
            continue
        cls = _metadata_class_name(boundary)
        metadata_class_map.append((boundary, cls))
        a("")
        a(f"class {cls}(BaseModel):")
        a(f'    """Metadata for boundary ``{boundary}`` (closed key set)."""')
        a("")
        a('    model_config = ConfigDict(extra="forbid")')
        a("")
        for k in keys:
            a(f"    {k}: Optional[Any] = None")
    a("")
    a("")

    # Map from boundary literal → metadata model class (for callers/tests).
    a("#: boundary literal → its closed metadata model (data-plane only).")
    a("BOUNDARY_METADATA_MODEL: dict[str, type[BaseModel]] = {")
    for boundary, cls in metadata_class_map:
        a(f'    "{boundary}": {cls},')
    a("}")
    a("")
    a("")

    # ── Envelope ───────────────────────────────────────────────────────────────
    a("class CvdiagEnvelope(BaseModel):")
    a('    """The CVDIAG flap-observability envelope (spec §5).')
    a("")
    a("    Unknown TOP-LEVEL keys are dropped (closed-world) and the drop is")
    a("    recorded via ``_metadata_dropped``; the ``metadata`` bag itself is")
    a("    free-form here (per-boundary closed validation is applied separately")
    a("    via ``BOUNDARY_METADATA_MODEL`` so a metadata-only unknown key does not")
    a("    reject the whole envelope, it just stamps ``_metadata_dropped``).")
    a('    """')
    a("")
    a('    model_config = ConfigDict(populate_by_name=True, extra="ignore")')
    a("")
    a(f"    schema_version: int = SCHEMA_VERSION")
    a("    test_id: str = Field(pattern=TEST_ID_PATTERN)")
    a("    trace_id: str")
    a("    span_id: str = Field(pattern=SPAN_ID_PATTERN)")
    a("    parent_span_id: Optional[str] = None")
    a("    layer: CvdiagLayer")
    a("    boundary: CvdiagBoundary")
    a("    slug: str = Field(pattern=SLUG_PATTERN)")
    a("    demo: str")
    a("    ts: str")
    a("    mono_ns: int")
    a("    duration_ms: Optional[int] = None")
    a("    outcome: CvdiagOutcome")
    a("    edge_headers: EdgeHeaders")
    a("    metadata: dict[str, Any] = Field(default_factory=dict)")
    a('    metadata_dropped: bool = Field(default=False, alias="_metadata_dropped")')
    a('    truncated: bool = Field(default=False, alias="_truncated")')
    a("")
    a('    @model_validator(mode="before")')
    a("    @classmethod")
    a("    def _stamp_dropped_unknown_keys(cls, data: Any) -> Any:")
    a('        """Stamp ``_metadata_dropped`` when unknown top-level OR metadata keys')
    a("        are present, then strip the unknown top-level keys (closed-world).")
    a('        """')
    a("        if not isinstance(data, dict):")
    a("            return data")
    a("        known = set(cls.model_fields.keys())")
    a("        aliases = {")
    a("            f.alias for f in cls.model_fields.values() if f.alias is not None")
    a("        }")
    a("        allowed = known | aliases")
    a("        dropped = False")
    a("        cleaned: dict[str, Any] = {}")
    a("        for key, value in data.items():")
    a("            if key in allowed:")
    a("                cleaned[key] = value")
    a("            else:")
    a("                dropped = True  # unknown top-level key → drop + stamp")
    a("        # Unknown metadata keys (against the per-boundary closed model).")
    a('        boundary = cleaned.get("boundary")')
    a('        meta = cleaned.get("metadata")')
    a("        if isinstance(boundary, str) and isinstance(meta, dict):")
    a("            model = BOUNDARY_METADATA_MODEL.get(boundary)")
    a("            if model is not None:")
    a("                allowed_meta = set(model.model_fields.keys())")
    a("                if any(mk not in allowed_meta for mk in meta):")
    a("                    dropped = True")
    a("        if dropped:")
    a('            cleaned["_metadata_dropped"] = True')
    a("        return cleaned")
    a("")

    return "\n".join(out) + "\n"


def load_schema() -> dict:
    return json.loads(_SCHEMA_JSON.read_text(encoding="utf-8"))


def render() -> str:
    return build_module(load_schema())


def main(argv: list[str]) -> int:
    rendered = render()
    if "--check" in argv:
        try:
            on_disk = _OUTPUT.read_text(encoding="utf-8")
        except FileNotFoundError:
            print(
                "CVDIAG codegen: cvdiag_schema.py is MISSING — run the generator and commit.",
                file=sys.stderr,
            )
            return 1
        if on_disk == rendered:
            print("CVDIAG codegen: cvdiag_schema.py is in sync with schema.json")
            return 0
        print(
            "CVDIAG codegen: cvdiag_schema.py is STALE — run the generator and commit.",
            file=sys.stderr,
        )
        return 1
    _OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"CVDIAG codegen: wrote {_OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
