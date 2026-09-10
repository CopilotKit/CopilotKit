#!/usr/bin/env python3
"""Classify the normalized global candidate matrix by static router policy."""

from __future__ import annotations
import json, re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tasks/docs-feature-audit"
DOCS = ROOT / "showcase/shell-docs/src/content/docs"


def doc_file(slug, base=DOCS):
    direct, nested = base / f"{slug}.mdx", base / slug / "index.mdx"
    return direct if direct.is_file() else nested if nested.is_file() else None


def policy_allows_angular(slug):
    page, value = doc_file(slug), None
    if page and page.read_text().startswith("---\n"):
        text = page.read_text()
        end = text.find("\n---", 4)
        value = (
            (yaml.safe_load(text[4:end]) or {}).get("frontend") if end >= 0 else None
        )
    parts = slug.split("/")
    for n in range(len(parts), -1, -1):
        if value is not None:
            break
        meta = DOCS.joinpath(*parts[:n], "meta.json")
        if meta.is_file():
            value = json.loads(meta.read_text()).get("frontend")
    return value == "universal" or (
        isinstance(value, dict)
        and value.get("kind") == "frontend-variant"
        and doc_file(slug, DOCS / "frontends" / "angular")
    )


def path(frontend, integration, slug):
    return (
        f"/{integration}/{slug}"
        if frontend == "react"
        else f"/{frontend}/{integration}/{slug}"
    )


def main():
    inv = json.loads((OUT / "global-feature-outline.json").read_text())
    text = (ROOT / "showcase/shell-docs/src/lib/frontend-page-content.ts").read_text()
    section = text.split("export const ANGULAR_DOC_REDIRECTS", 1)[1].split("};", 1)[0]
    redirects = dict(re.findall(r'^\s*"([^"]+)":\s*"([^"]+)",?$', section, re.M))
    folders = {x["slug"]: x["docs_folder"] for x in inv["public_integrations"]}
    rows = []
    for frontend in inv["axes"]["frontends"]:
        for integration in inv["axes"]["integrations"]:
            for feature in inv["axes"]["features"]:
                fid, guide = feature["id"], feature["guide_path"]
                cell_id = f"{frontend}:{integration}:{fid}"
                if not guide:
                    rows.append([cell_id, "no-guide-mapping", None, None, None])
                    continue
                slug, candidate = (
                    guide.lstrip("/"),
                    path(frontend, integration, guide.lstrip("/")),
                )
                if frontend != "angular":
                    source = inv["source_resolutions_by_integration_feature"][
                        integration
                    ][fid]
                    rows.append(
                        [
                            cell_id,
                            "framework-guide-content"
                            if source["state"] == "source-present"
                            else "framework-availability-fallback",
                            candidate,
                            source.get("path"),
                            None,
                        ]
                    )
                    continue
                canonical = redirects.get(slug, slug)
                angular = doc_file(canonical, DOCS / "frontends" / "angular")
                shared = (
                    doc_file(canonical) if policy_allows_angular(canonical) else None
                )
                backend = doc_file(
                    canonical, DOCS / "integrations" / folders[integration]
                )
                source = angular or shared or backend
                kind = (
                    "angular"
                    if angular
                    else "shared-frontend-policy"
                    if shared
                    else "backend"
                    if backend
                    else None
                )
                rows.append(
                    [
                        cell_id,
                        "angular-native-or-redirected-guide"
                        if source
                        else "angular-not-found",
                        path("angular", integration, canonical),
                        str(source.relative_to(ROOT)) if source else None,
                        kind,
                    ]
                )
    if len(rows) != inv["counts"]["potential_cells"]:
        raise RuntimeError("matrix rows lost")
    counts = dict(Counter(x[1] for x in rows))
    content = [
        x
        for x in rows
        if x[1] in {"framework-guide-content", "angular-native-or-redirected-guide"}
    ]
    result = {
        "schema_version": 2,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "generated_by": "tasks/docs-feature-audit/generate_global_route_reachability.py",
        "method": "Static router-policy analysis only; no HTTP or rendered-page claim.",
        "row_encoding": "[cell_id, route_state, canonical_route, content_source, source_kind]",
        "counts": counts,
        "content_bearing_candidate_cells": len(content),
        "unique_content_bearing_candidate_routes": len({x[2] for x in content}),
        "rows": rows,
    }
    (OUT / "global-route-reachability.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    lines = [
        "# Global route reachability classification",
        "",
        result["method"],
        "",
        "## Results",
        "",
        *[f"- `{k}`: {v}." for k, v in sorted(counts.items())],
        f"- Content-bearing candidate cells: {len(content)}; unique canonical route candidates: {result['unique_content_bearing_candidate_routes']}.",
        "",
        "`framework-guide-content` and Angular task-guide results are candidates for later rendered validation. Availability fallback and Angular no-source outcomes are not raw 404 verdicts. Vue/React Native remain not-declared for support despite recognized backend-scoped routes.",
    ]
    (OUT / "global-route-reachability.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
