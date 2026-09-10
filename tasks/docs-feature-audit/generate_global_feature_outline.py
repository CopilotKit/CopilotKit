#!/usr/bin/env python3
"""Generate the read-only global feature-guide audit outline.

The artifact inventories potential docs routes separately from declared support and
runtime qualification. It deliberately neither edits Showcase data nor treats a
manifest entry, route candidate, or source fallback as a passing implementation.
"""

from __future__ import annotations

import json
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tasks/docs-feature-audit"
DOCS = ROOT / "showcase/shell-docs/src/content/docs"
FEATURES = ROOT / "showcase/shared/feature-registry.json"
FRONTENDS = ROOT / "showcase/shared/frontend-registry.json"
MANIFESTS = ROOT / "showcase/integrations"
TARGET_FRONTENDS = ("react", "angular", "vue", "react-native")
FOLDER_OVERRIDES = {
    "langgraph-python": "langgraph",
    "langgraph-typescript": "langgraph",
    "langgraph-fastapi": "langgraph",
    "google-adk": "adk",
    "crewai-crews": "crewai-flows",
    "strands": "aws-strands",
    "strands-typescript": "aws-strands",
    "ms-agent-dotnet": "microsoft-agent-framework",
    "ms-agent-python": "microsoft-agent-framework",
    "ms-agent-harness-dotnet": "microsoft-agent-framework",
}
SPECIAL_OVERRIDE_SLUGS = {"quickstart", "threads-import"}


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def doc_file(slug: str, base: Path = DOCS) -> Path | None:
    direct = base / f"{slug}.mdx"
    nested = base / slug / "index.mdx"
    if direct.is_file():
        return direct
    if nested.is_file():
        return nested
    return None


def manifest_status(fid: str, manifest: dict) -> str:
    if fid in (manifest.get("not_supported_features") or []):
        return "manifest-unsupported"
    if fid not in (manifest.get("features") or []):
        return "unshipped"
    demos = [d for d in (manifest.get("demos") or []) if d.get("id") == fid]
    if not demos:
        return "unshipped"
    return (
        "declared-wired"
        if any(d.get("route") for d in demos)
        else "declared-docs-or-command-only"
    )


def effective_source(slug: str, mode: str, guide_slug: str) -> dict:
    root = doc_file(guide_slug)
    folder = FOLDER_OVERRIDES.get(slug, slug)
    framework = doc_file(guide_slug, DOCS / "integrations" / folder)
    if mode == "authored":
        if framework:
            return {
                "state": "source-present",
                "precedence": "authored-framework-first",
                "path": rel(framework),
            }
        if root:
            return {
                "state": "source-present",
                "precedence": "authored-root-fallback",
                "path": rel(root),
            }
    else:
        if guide_slug in SPECIAL_OVERRIDE_SLUGS and framework:
            return {
                "state": "source-present",
                "precedence": "generated-special-framework-override",
                "path": rel(framework),
            }
        if root:
            return {
                "state": "source-present",
                "precedence": "generated-root-first",
                "path": rel(root),
            }
        if framework:
            return {
                "state": "source-present",
                "precedence": "generated-framework-fallback",
                "path": rel(framework),
            }
    return {
        "state": "no-effective-source",
        "precedence": "no-current-source",
        "path": None,
    }


def projected_route(frontend: str, integration: str, guide_path: str) -> str:
    # Mirrors frontendPathForBackend() for non-empty catalog paths. Its quickstart
    # exception does not apply here because a selected backend is always present.
    prefix = f"/{integration}" if frontend == "react" else f"/{frontend}/{integration}"
    return prefix + guide_path


def main() -> None:
    features_data = json.loads(FEATURES.read_text())
    frontend_data = json.loads(FRONTENDS.read_text())
    features = [f for f in features_data["features"] if not f.get("deprecated")]
    manifests: list[tuple[str, dict, Path]] = []
    for path in sorted(MANIFESTS.glob("*/manifest.yaml")):
        manifest = yaml.safe_load(path.read_text()) or {}
        slug = manifest.get("slug", path.parent.name)
        if manifest.get("docs_mode", "generated") != "hidden":
            manifests.append((slug, manifest, path))

    guide_groups: dict[str, list[str]] = defaultdict(list)
    for feature in features:
        if feature.get("shell_docs_path"):
            guide_groups[feature["shell_docs_path"]].append(feature["id"])

    rows = []
    for frontend in TARGET_FRONTENDS:
        for integration, manifest, manifest_path in manifests:
            for feature in features:
                fid = feature["id"]
                guide_path = feature.get("shell_docs_path")
                frontend_declaration = (
                    frontend_data.get("feature_support", {}).get(fid, {}) or {}
                ).get(frontend)
                if frontend_declaration is None:
                    frontend_declaration = {
                        "state": "not-declared",
                        "reason": "No per-feature declaration exists in frontend-registry.json.",
                    }
                if not guide_path:
                    binding = {
                        "state": "missing-feature-guide-mapping",
                        "route": None,
                        "source": None,
                    }
                else:
                    binding = {
                        "state": "mapped",
                        "route": projected_route(frontend, integration, guide_path),
                        "source": effective_source(
                            integration,
                            manifest.get("docs_mode", "generated"),
                            guide_path.lstrip("/"),
                        ),
                    }
                rows.append(
                    {
                        "cell_id": f"{frontend}:{integration}:{fid}",
                        "frontend": frontend,
                        "integration": integration,
                        "integration_docs_mode": manifest.get("docs_mode", "generated"),
                        "manifest_path": rel(manifest_path),
                        "feature_id": fid,
                        "feature_category": feature.get("category"),
                        "feature_kind": feature.get("kind", "primary"),
                        "guide_binding": binding,
                        "frontend_declaration": frontend_declaration,
                        "backend_declaration": manifest_status(fid, manifest),
                        "ownership": {
                            "frontend_support_source": "showcase/shared/frontend-registry.json",
                            "backend_support_source": rel(manifest_path),
                            "guide_source_owner": "not declared in inventory source; requires maintainer assignment before qualification",
                        },
                        "runtime_status": "not-run",
                    }
                )

    selected_inventory = json.loads((OUT / "inventory.json").read_text())
    product_units = selected_inventory.get("product_guide_units", [])
    counts = {
        "public_integrations": len(manifests),
        "excluded_hidden_integrations": sorted(
            p.parent.name
            for p in MANIFESTS.glob("*/manifest.yaml")
            if (yaml.safe_load(p.read_text()) or {}).get("docs_mode", "generated")
            == "hidden"
        ),
        "target_frontends": list(TARGET_FRONTENDS),
        "active_taxonomy_features": len(features),
        "mapped_catalog_feature_routes": len(guide_groups),
        "unmapped_feature_ids": sorted(
            f["id"] for f in features if not f.get("shell_docs_path")
        ),
        "potential_cells": len(rows),
        "guide_mapped_cells": sum(
            r["guide_binding"]["state"] == "mapped" for r in rows
        ),
        "source_state_counts": dict(
            Counter(
                (r["guide_binding"].get("source") or {}).get(
                    "state", "no-guide-mapping"
                )
                for r in rows
            )
        ),
        "backend_declaration_counts": dict(
            Counter(r["backend_declaration"] for r in rows)
        ),
        "frontend_declaration_counts": {
            frontend: dict(
                Counter(
                    r["frontend_declaration"]["state"]
                    for r in rows
                    if r["frontend"] == frontend
                )
            )
            for frontend in TARGET_FRONTENDS
        },
        "product_guide_units": len(product_units),
        "product_guide_family_counts": dict(
            Counter(u["family"] for u in product_units)
        ),
    }
    expected_cells = len(manifests) * len(TARGET_FRONTENDS) * len(features)
    if (
        len(rows) != expected_cells
        or len({row["cell_id"] for row in rows}) != expected_cells
    ):
        raise RuntimeError("global matrix is incomplete or has duplicate cell IDs")
    # Keep the durable artifact below the repository's 1 MiB generated-file
    # guard. The Cartesian matrix is losslessly reconstructed from these axes;
    # do not serialize the same source/declaration fields 3,168 times.
    feature_axis = [
        {
            "id": feature["id"],
            "category": feature.get("category"),
            "kind": feature.get("kind", "primary"),
            "guide_path": feature.get("shell_docs_path"),
        }
        for feature in features
    ]
    frontend_declarations = {
        frontend: {
            feature["id"]: (
                (
                    frontend_data.get("feature_support", {}).get(feature["id"], {})
                    or {}
                ).get(frontend)
                or {
                    "state": "not-declared",
                    "reason": "No per-feature declaration exists in frontend-registry.json.",
                }
            )
            for feature in features
        }
        for frontend in TARGET_FRONTENDS
    }
    backend_declarations = {
        slug: {
            feature["id"]: manifest_status(feature["id"], manifest)
            for feature in features
        }
        for slug, manifest, _ in manifests
    }
    source_resolutions = {
        slug: {
            feature["id"]: (
                effective_source(
                    slug,
                    manifest.get("docs_mode", "generated"),
                    feature["shell_docs_path"].lstrip("/"),
                )
                if feature.get("shell_docs_path")
                else None
            )
            for feature in features
        }
        for slug, manifest, _ in manifests
    }
    artifact = {
        "schema_version": 1,
        "generated_by": "tasks/docs-feature-audit/generate_global_feature_outline.py",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "audit_workspace_head": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "product_source_baseline": selected_inventory.get("metadata", {}).get(
            "baseline_source_revision"
        ),
        "scope_rule": "The matrix is the Cartesian product of axes.frontends × axes.integrations × axes.features, in that order. Position is ((frontend_index * integration_count) + integration_index) * feature_count + feature_index. A cell is a projected route candidate only when its feature guide_path is present; projected URLs mirror frontendPathForBackend(), but are not rendered-route proof. All runtime states are not-run.",
        "counts": counts,
        "public_integrations": [
            {
                "slug": slug,
                "name": manifest.get("name"),
                "docs_mode": manifest.get("docs_mode", "generated"),
                "docs_folder": FOLDER_OVERRIDES.get(slug, slug),
            }
            for slug, manifest, _ in manifests
        ],
        "catalog_guide_units": [
            {"canonical_route": route, "feature_ids": ids, "feature_count": len(ids)}
            for route, ids in sorted(guide_groups.items())
        ],
        "product_guide_units": product_units,
        "axes": {
            "frontends": list(TARGET_FRONTENDS),
            "integrations": [slug for slug, _, _ in manifests],
            "features": feature_axis,
        },
        "frontend_declarations_by_frontend_feature": frontend_declarations,
        "backend_declarations_by_integration_feature": backend_declarations,
        "source_resolutions_by_integration_feature": source_resolutions,
        "shared_cell_fields": {
            "runtime_status": "not-run",
            "frontend_support_source": "showcase/shared/frontend-registry.json",
            "guide_source_owner": "not declared in inventory source; requires maintainer assignment before qualification",
        },
    }
    (OUT / "global-feature-outline.json").write_text(
        json.dumps(artifact, indent=2) + "\n"
    )
    lines = [
        "# Global feature-guide outline",
        "",
        "Read-only scope evidence. It is an inventory, never runtime qualification.",
        "",
        "## Inclusion rule",
        "",
        "One row exists for each public Showcase integration × intended product frontend (React, Angular, Vue, React Native) × active catalog feature. A feature without `shell_docs_path` is retained as an explicit missing-mapping row; it is not projected to a route. Hidden integration manifests are excluded from the public-agent scope. Threads, Intelligence, and Channels remain separately enumerated product-guide units because they are outside the catalog feature-ID taxonomy.",
        "",
        "## Counts",
        "",
        f"- Public integrations: {counts['public_integrations']}; excluded hidden: {', '.join(counts['excluded_hidden_integrations'])}.",
        f"- {counts['active_taxonomy_features']} active catalog features; {counts['mapped_catalog_feature_routes']} canonical catalog routes; unmapped: {', '.join(counts['unmapped_feature_ids'])}.",
        f"- Potential frontend/agent/feature cells: {counts['potential_cells']}; guide-mapped route candidates: {counts['guide_mapped_cells']}.",
        f"- Effective content source: {counts['source_state_counts'].get('source-present', 0)} present, {counts['source_state_counts'].get('no-effective-source', 0)} unavailable, {counts['source_state_counts'].get('no-guide-mapping', 0)} no guide mapping.",
        f"- Backend declaration: {', '.join(f'{k}={v}' for k, v in sorted(counts['backend_declaration_counts'].items()))}.",
        f"- Product-guide units: {counts['product_guide_units']} ({', '.join(f'{k}={v}' for k, v in sorted(counts['product_guide_family_counts'].items()))}).",
        "",
        "## Frontend declarations",
        "",
    ]
    for frontend, states in counts["frontend_declaration_counts"].items():
        lines.append(
            f"- `{frontend}`: "
            + ", ".join(f"{state}={count}" for state, count in sorted(states.items()))
            + "."
        )
    lines += [
        "",
        "## Interpretation",
        "",
        "- React and Angular have registry declarations; Vue and React Native currently have no per-feature declarations, so their rows remain `not-declared` rather than being inferred unsupported.",
        "- A manifest-unsupported, unshipped, no-effective-source, or not-declared cell is retained for complete coverage accounting. None is a 404 defect conclusion by itself.",
        "- `ownership` records source-of-truth ownership only. Guide-maintainer ownership is not declared in the existing registries and needs assignment before qualifying repairs.",
        "- See `global-feature-outline.json` for every route candidate, declaration, effective-source result, and runtime placeholder.",
    ]
    (OUT / "global-feature-outline.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
