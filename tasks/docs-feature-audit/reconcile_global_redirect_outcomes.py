#!/usr/bin/env python3
"""Classify final redirect outcomes against the normalized feature matrix."""

import json
from collections import Counter
from pathlib import Path

OUT = Path(__file__).parent


def main():
    initial = json.loads((OUT / "global-rendered-route-audit.json").read_text())
    redirects = json.loads((OUT / "global-rendered-redirect-audit.json").read_text())
    outline = json.loads((OUT / "global-feature-outline.json").read_text())
    reachability = json.loads((OUT / "global-route-reachability.json").read_text())
    route_state = {row[0]: row[1] for row in reachability["rows"]}
    missing, markers = [], []
    for key, result in redirects["records"].items():
        route, representation = key.rsplit("|", 1)
        outcome, _, status, _, visible_markers, _, final_path = result
        if visible_markers:
            markers.append([route, representation, final_path, visible_markers])
        if outcome != "local-final" or status != 404:
            continue
        for cell_id in initial["cell_bindings"][route]:
            if cell_id.count(":") != 2:
                continue
            frontend, integration, feature = cell_id.split(":", 2)
            missing.append(
                [
                    cell_id,
                    route,
                    representation,
                    final_path,
                    outline["frontend_declarations_by_frontend_feature"][frontend][
                        feature
                    ]["state"],
                    outline["backend_declarations_by_integration_feature"][integration][
                        feature
                    ],
                    route_state[cell_id],
                ]
            )
    classifications = Counter()
    for row in missing:
        frontend_state, backend_state = row[4], row[5]
        if frontend_state == "supported" and backend_state == "declared-wired":
            classifications["declared_supported_final_missing"] += 1
        elif frontend_state == "not-declared":
            classifications["frontend_not_declared_final_missing"] += 1
        else:
            classifications["other_final_missing"] += 1
    output = {
        "schema_version": 1,
        "scope": "classification only: final local redirect outcomes joined to source-of-truth frontend/backend declarations; no new HTTP requests",
        "missing_record_encoding": "[cell_id, initial_route, representation, final_local_path, frontend_declaration, backend_declaration, static_route_state]",
        "summary": {
            "final_404_representations": sum(
                result[0] == "local-final" and result[2] == 404
                for result in redirects["records"].values()
            ),
            "final_missing_impacted_cells": len(missing),
            "classification_counts": dict(sorted(classifications.items())),
            "declared_supported_final_missing": classifications[
                "declared_supported_final_missing"
            ],
            "redirect_final_visible_marker_records": len(markers),
        },
        "final_missing_cells": missing,
        "redirect_final_visible_markers": markers,
    }
    (OUT / "global-redirect-outcome-reconciliation.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )
    counts = output["summary"]["classification_counts"]
    (OUT / "global-redirect-outcome-reconciliation.md").write_text(
        "# Redirect outcome reconciliation\n\n"
        "This joins final local redirect results to declared frontend/backend capability. A final 404 alone is not treated as a defect.\n\n"
        f"- Final 404 representations: {output['summary']['final_404_representations']}.\n"
        f"- Impacted feature-context cells: {len(missing)}.\n"
        f"- Declared-supported final missing cells: {counts.get('declared_supported_final_missing', 0)}.\n"
        f"- Frontend-not-declared final missing cells: {counts.get('frontend_not_declared_final_missing', 0)}.\n"
        f"- Other final missing cells: {counts.get('other_final_missing', 0)}.\n"
        f"- Redirect finals with visible error markers: {len(markers)}.\n"
    )


if __name__ == "__main__":
    main()
