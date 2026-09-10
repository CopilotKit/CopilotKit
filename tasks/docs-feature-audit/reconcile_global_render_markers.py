#!/usr/bin/env python3
"""Join visible rendered-page error markers to feature-context declarations."""

import json
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).parent


def cell_context(cell_id, outline, route_state):
    if cell_id.count(":") != 2:
        return [
            cell_id,
            "product-guide",
            "product-guide",
            "product-guide",
            route_state.get(cell_id),
        ]
    frontend, integration, feature = cell_id.split(":", 2)
    return [
        cell_id,
        outline["frontend_declarations_by_frontend_feature"][frontend][feature][
            "state"
        ],
        outline["backend_declarations_by_integration_feature"][integration][feature],
        integration,
        route_state.get(cell_id),
    ]


def main():
    initial = json.loads((OUT / "global-rendered-route-audit.json").read_text())
    redirects = json.loads((OUT / "global-rendered-redirect-audit.json").read_text())
    markers = json.loads((OUT / "global-rendered-marker-audit.json").read_text())
    outline = json.loads((OUT / "global-feature-outline.json").read_text())
    reachability = json.loads((OUT / "global-route-reachability.json").read_text())
    route_state = {row[0]: row[1] for row in reachability["rows"]}
    final_to_initial = defaultdict(set)
    for route, _, html, _ in initial["routes"]:
        if html[0] == 200:
            final_to_initial[route].add(route)
    for key, record in redirects["records"].items():
        route, representation = key.rsplit("|", 1)
        if (
            representation == "html"
            and record[0] == "local-final"
            and record[2] == 200
            and record[6]
        ):
            final_to_initial[record[6]].add(route)
    alerts = []
    all_contexts = []
    for path, record in markers["records"].items():
        if not record[2]:
            continue
        cells = sorted(
            {
                cell
                for source in final_to_initial.get(path, set())
                for cell in initial["cell_bindings"].get(source, [])
            }
        )
        contexts = [cell_context(cell, outline, route_state) for cell in cells]
        alerts.append(
            {
                "final_path": path,
                "title": record[1],
                "visible_error_markers": record[2],
                "initial_routes": sorted(final_to_initial.get(path, set())),
                "contexts": contexts,
            }
        )
        all_contexts.extend(contexts)
    frontend = Counter(row[1] for row in all_contexts)
    backend = Counter(row[2] for row in all_contexts)
    supported_wired = sum(
        row[1] == "supported" and row[2] == "declared-wired" for row in all_contexts
    )
    output = {
        "schema_version": 1,
        "scope": "visible rendered local HTML error markers joined to the source-of-truth context declarations; marker presence is a rendered-page defect signal, while context declarations determine support scope",
        "context_encoding": "[cell_id, frontend_declaration, backend_declaration, integration, static_route_state]",
        "summary": {
            "marker_paths": len(alerts),
            "marker_records": sum(
                len(alert["visible_error_markers"]) for alert in alerts
            ),
            "impacted_context_cells": len(all_contexts),
            "frontend_declarations": dict(sorted(frontend.items())),
            "backend_declarations": dict(sorted(backend.items())),
            "declared_supported_wired_impacted_cells": supported_wired,
        },
        "alerts": alerts,
    }
    (OUT / "global-rendered-marker-reconciliation.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )
    lines = [
        "# Rendered marker reconciliation",
        "",
        "Marker paths were fetched only from local shell-docs HTML. This joins each visible error callout to declared context; it does not turn unshipped or frontend-not-declared cells into supported defects.",
        "",
        f"- Marker paths: {output['summary']['marker_paths']}.",
        f"- Marker records: {output['summary']['marker_records']}.",
        f"- Impacted context cells: {output['summary']['impacted_context_cells']}.",
        f"- Declared-supported/wired impacted cells: {supported_wired}.",
        f"- Frontend declarations: {', '.join(f'{k}={v}' for k, v in sorted(frontend.items()))}.",
        f"- Backend declarations: {', '.join(f'{k}={v}' for k, v in sorted(backend.items()))}.",
        "",
        "## Rendered callouts",
        "",
    ]
    for alert in alerts:
        lines.append(
            f"- `{alert['final_path']}` ({alert['title']}) — {', '.join(alert['visible_error_markers'])}; contexts={len(alert['contexts'])}."
        )
    (OUT / "global-rendered-marker-reconciliation.md").write_text(
        "\n".join(lines) + "\n"
    )


if __name__ == "__main__":
    main()
