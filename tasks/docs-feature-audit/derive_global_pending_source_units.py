#!/usr/bin/env python3
"""Derive de-duplicated global feature-guide review units from audit inventories."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tasks/docs-feature-audit"
CONTENT_STATES = {"framework-guide-content", "angular-native-or-redirected-guide"}


def main() -> None:
    selected = json.loads((OUT / "inventory.json").read_text())
    outline = json.loads((OUT / "global-feature-outline.json").read_text())
    reachability = json.loads((OUT / "global-route-reachability.json").read_text())
    prior_path = OUT / "global-pending-source-units.json"
    prior = json.loads(prior_path.read_text()) if prior_path.is_file() else {}
    prior_status = {
        unit["path"]: unit.get("review_status", "pending-manual-content-review")
        for unit in prior.get("units", [])
    }
    prior_note = {
        unit["path"]: unit.get("review_note") for unit in prior.get("units", [])
    }

    selected_sources = {
        cell["resolved_content"]["path"]
        for cell in selected["selected_matrix"]
        if cell["resolved_content"]["status"] == "resolved"
    }
    product_sources = {
        unit["root_source_path"]
        for unit in outline["product_guide_units"]
        if unit["root_source_status"] == "present"
    }

    bindings: dict[str, list[dict[str, str | None]]] = defaultdict(list)
    excluded = defaultdict(int)
    for cell_id, route_state, route, source, source_kind in reachability["rows"]:
        frontend, integration, feature_id = cell_id.split(":", 2)
        if route_state not in CONTENT_STATES or source is None:
            excluded[f"route_state:{route_state}"] += 1
            continue
        if source in selected_sources:
            excluded["already-reviewed:selected-matrix-source"] += 1
            continue
        # Product roots are separately reviewed. None currently enter the
        # feature-cell reachability matrix, but retain the guard for reruns.
        if source in product_sources:
            excluded["already-reviewed:product-root-source"] += 1
            continue
        bindings[source].append(
            {
                "cell_id": cell_id,
                "frontend": frontend,
                "integration": integration,
                "feature_id": feature_id,
                "canonical_route": route,
                "route_state": route_state,
                "source_kind": source_kind,
            }
        )

    units = []
    for source, cells in sorted(bindings.items()):
        cells.sort(
            key=lambda item: (str(item["canonical_route"]), str(item["cell_id"]))
        )
        units.append(
            {
                "path": source,
                "exists": (ROOT / source).is_file(),
                "canonical_routes": sorted(
                    {str(item["canonical_route"]) for item in cells}
                ),
                "frontends": sorted({str(item["frontend"]) for item in cells}),
                "integrations": sorted({str(item["integration"]) for item in cells}),
                "feature_ids": sorted({str(item["feature_id"]) for item in cells}),
                "source_kinds": sorted({str(item["source_kind"]) for item in cells}),
                "cell_count": len(cells),
                "cell_bindings": cells,
                "review_status": prior_status.get(
                    source, "pending-manual-content-review"
                ),
                **(
                    {"review_note": prior_note[source]}
                    if prior_note.get(source)
                    else {}
                ),
            }
        )

    result = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "generated_by": "tasks/docs-feature-audit/derive_global_pending_source_units.py",
        "scope": {
            "in_scope_frontends": outline["axes"]["frontends"],
            "source_route_states": sorted(CONTENT_STATES),
            "angular_resolution": "global-route-reachability uses resolveAngularDoc-equivalent canonical redirect, frontend policy, and backend fallback resolution",
            "frontend_support_note": "Vue and React Native route bindings remain in the inventory even where support is not declared. Delivery and support state must be reported separately.",
        },
        "reviewed_exclusions": {
            "selected_matrix_resolved_sources": len(selected_sources),
            "product_root_sources": len(product_sources),
            "shared_snippets_and_product_dependencies": "Previously reviewed transitive units are not direct feature-route resolution rows; they remain documented in content-audit.md and product-guide-audit.md.",
        },
        "counts": {
            "pending_unique_source_units": len(units),
            "pending_cell_bindings": sum(unit["cell_count"] for unit in units),
            "pending_unique_canonical_routes": len(
                {route for unit in units for route in unit["canonical_routes"]}
            ),
            "excluded_cell_rows": dict(sorted(excluded.items())),
        },
        "units": units,
    }
    (OUT / "global-pending-source-units.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )

    status_counts = defaultdict(int)
    for unit in units:
        status_counts[unit["review_status"]] += 1
    reviewed = sum(
        value for key, value in status_counts.items() if key.startswith("reviewed-")
    )
    pending = len(units) - reviewed

    lines = [
        "# Global pending feature-guide source units",
        "",
        "Derived from normalized route reachability. Each source is reviewed once; all listed route/cell bindings inherit that review.",
        "",
        "## Scope",
        "",
        "- React, Vue, and React Native routes use their resolved framework source; Angular routes use canonical redirects plus Angular/native/shared/backend resolution.",
        "- Vue and React Native bindings remain even where a framework does not declare support. Source delivery and declared support are distinct audit dimensions.",
        "- The previously completed selected matrix, product roots, shared snippets, and product dependencies are excluded from new manual review.",
        "",
        "## Coverage",
        "",
        f"- Reviewed: {reviewed}.",
        f"- Pending: {pending}.",
        f"- Unique source units: {len(units)}.",
        f"- Canonical routes represented: {result['counts']['pending_unique_canonical_routes']}.",
        f"- All frontend cell bindings represented: {result['counts']['pending_cell_bindings']}.",
        "",
        "## Units",
        "",
    ]
    for index, unit in enumerate(units, 1):
        note = f" Note: {unit['review_note']}" if unit.get("review_note") else ""
        lines.append(
            f"{index}. `{unit['path']}` — {unit['cell_count']} bindings; routes: {', '.join(unit['canonical_routes'])}; status: {unit['review_status']}.{note}"
        )
    (OUT / "global-pending-source-units.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
