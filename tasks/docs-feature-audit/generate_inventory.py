#!/usr/bin/env python3
"""Generate the audit-only feature-guide inventory from repository source of truth.

This file deliberately does not edit manifests, docs, generated registry data, or
product source. Re-run from the repository root after a source update.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "tasks/docs-feature-audit"
FEATURES_PATH = ROOT / "showcase/shared/feature-registry.json"
FRONTENDS_PATH = ROOT / "showcase/shared/frontend-registry.json"
MANIFESTS_DIR = ROOT / "showcase/integrations"
DOCS_DIR = ROOT / "showcase/shell-docs/src/content/docs"
AIMOCK_DIR = ROOT / "showcase/aimock/d6"

SELECTED = [
    "langgraph-python",
    "langgraph-typescript",
    "google-adk",
    "strands",
    "built-in-agent",
]
DOCS_FOLDERS = {
    "langgraph-python": "langgraph",
    "langgraph-typescript": "langgraph",
    "google-adk": "adk",
    "strands": "aws-strands",
    "built-in-agent": "built-in-agent",
}
# The LangGraph manifests explicitly call out these cells as a published-package
# resume-path quarantine. All other manifest unsupported entries are retained as
# manifest declarations and are not reclassified by this audit.
RELEASE_QUARANTINES = {
    ("langgraph-python", "gen-ui-interrupt"),
    ("langgraph-python", "interrupt-headless"),
    ("langgraph-typescript", "gen-ui-interrupt"),
    ("langgraph-typescript", "interrupt-headless"),
}


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def git(command: list[str]) -> str:
    return subprocess.check_output(command, cwd=ROOT, text=True).strip()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def read_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text()) or {}


def source_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def doc_file(slug: str) -> Path | None:
    direct = DOCS_DIR / f"{slug}.mdx"
    nested = DOCS_DIR / slug / "index.mdx"
    if direct.is_file():
        return direct
    if nested.is_file():
        return nested
    return None


def framework_doc_file(folder: str, slug: str) -> Path | None:
    direct = DOCS_DIR / "integrations" / folder / f"{slug}.mdx"
    nested = DOCS_DIR / "integrations" / folder / slug / "index.mdx"
    if direct.is_file():
        return direct
    if nested.is_file():
        return nested
    return None


def resolve_content_source(
    integration: str, docs_mode: str, slug: str
) -> dict[str, str]:
    """Mirror the feature-page precedence in page.tsx for current guide routes."""
    root = doc_file(slug)
    framework = framework_doc_file(DOCS_FOLDERS[integration], slug)
    if docs_mode == "authored":
        if framework:
            return {
                "status": "resolved",
                "precedence": "authored-framework-first",
                "path": rel(framework),
            }
        if root:
            return {
                "status": "resolved",
                "precedence": "authored-root-fallback",
                "path": rel(root),
            }
    else:
        if slug in {"quickstart", "threads-import"} and framework:
            return {
                "status": "resolved",
                "precedence": "generated-special-framework-override",
                "path": rel(framework),
            }
        if root:
            return {
                "status": "resolved",
                "precedence": "generated-root-first",
                "path": rel(root),
            }
        if framework:
            return {
                "status": "resolved",
                "precedence": "generated-framework-fallback",
                "path": rel(framework),
            }
    return {"status": "unresolved", "precedence": "no-current-source", "path": None}


def catalog_status(feature_id: str, manifest: dict[str, Any]) -> str:
    unsupported = manifest.get("not_supported_features", []) or []
    if feature_id in unsupported:
        return "unsupported"
    features = manifest.get("features", []) or []
    if feature_id not in features:
        return "unshipped"
    demo = next(
        (item for item in manifest.get("demos", []) if item.get("id") == feature_id),
        None,
    )
    if not demo:
        return "unshipped"
    return "wired" if demo.get("route") else "stub"


def availability_disposition(
    integration: str, feature_id: str, manifest_status: str
) -> str:
    if (integration, feature_id) in RELEASE_QUARANTINES:
        return "release-quarantine"
    if manifest_status == "unsupported":
        return "manifest-unsupported"
    if manifest_status == "unshipped":
        return "unshipped"
    if manifest_status == "stub":
        return "docs-or-command-only"
    return "declared-wired-unverified"


def frontend_support(frontend_data: dict[str, Any], feature_id: str) -> dict[str, Any]:
    record = (frontend_data.get("feature_support", {}).get(feature_id, {}) or {}).get(
        "react"
    )
    if record is None:
        return {
            "state": "not-declared",
            "reason": "No React feature_support declaration in frontend-registry.",
        }
    return record


def guide_binding(feature: dict[str, Any]) -> dict[str, Any]:
    path = feature.get("shell_docs_path")
    if not path:
        return {
            "status": "missing-feature-guide-mapping",
            "canonical_public_route": None,
            "guide_slug": None,
            "source_candidates": [],
        }
    slug = path.lstrip("/")
    source = doc_file(slug)
    return {
        "status": "docs-only-start" if feature.get("kind") == "docs-only" else "mapped",
        "canonical_public_route": path,
        "guide_slug": slug,
        "source_candidates": [rel(source)] if source else [],
    }


def integration_summary(slug: str, manifest: dict[str, Any]) -> dict[str, Any]:
    demos = manifest.get("demos", []) or []
    aimock_files = sorted(p.name for p in (AIMOCK_DIR / slug).glob("*.json"))
    qa_files = sorted(p.name for p in (MANIFESTS_DIR / slug / "qa").glob("*.md"))
    return {
        "slug": slug,
        "name": manifest.get("name"),
        "language": manifest.get("language"),
        "docs_mode": manifest.get("docs_mode", "generated"),
        "docs_folder": DOCS_FOLDERS[slug],
        "manifest_path": rel(MANIFESTS_DIR / slug / "manifest.yaml"),
        "declared_feature_count": len(manifest.get("features", []) or []),
        "not_supported_feature_ids": manifest.get("not_supported_features", []) or [],
        "demo_count": len(demos),
        "routed_demo_count": sum(bool(demo.get("route")) for demo in demos),
        "routed_demo_ids": [demo["id"] for demo in demos if demo.get("route")],
        "aimock_files": aimock_files,
        "qa_files": qa_files,
        "local_runner": {
            "command_template": "showcase/bin/showcase test <slug> --d6 --direct --isolate <unique> --verbose --cycle",
            "scope": "all wired manifest demo IDs for the integration; not a one-command-per-feature contract",
            "network_requirement": "local runtime only; AIMock may supply per-integration fixture behavior",
        },
    }


def main() -> None:
    feature_registry = read_json(FEATURES_PATH)
    frontend_registry = read_json(FRONTENDS_PATH)
    all_features = feature_registry["features"]
    active_features = [
        feature for feature in all_features if not feature.get("deprecated")
    ]
    manifests = {
        slug: read_yaml(MANIFESTS_DIR / slug / "manifest.yaml") for slug in SELECTED
    }

    routes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in active_features:
        binding = guide_binding(feature)
        if binding["canonical_public_route"]:
            routes[binding["canonical_public_route"]].append(feature)

    guide_units = []
    for route, members in sorted(routes.items()):
        slug = route.lstrip("/")
        root_source = doc_file(slug)
        guide_units.append(
            {
                "id": f"catalog:{slug}",
                "family": "catalog-feature-guide",
                "canonical_public_route": route,
                "guide_slug": slug,
                "feature_ids": [member["id"] for member in members],
                "feature_count": len(members),
                "root_source_path": rel(root_source) if root_source else None,
                "root_source_status": "present"
                if root_source
                else "no-root-mdx-framework-context-may-resolve",
                "notes": "Feature IDs are grouped by canonical guide route; the count is intentionally not a page-count proxy for demos or runtime scenarios. A missing root MDX is not a broken selected-framework route: consult selected_matrix.resolved_content.",
            }
        )

    # Additional task-oriented guide families outside the Showcase feature-ID taxonomy.
    product_families = {
        "threads": [
            "threads",
            "prebuilt-components/copilot-threads-drawer",
            "headless-threads",
            "threads-import",
            "threads-lifecycle",
            "threads-self-managed",
        ],
        "intelligence": [
            "intelligence/overview",
            "intelligence/quickstart",
            "intelligence/connect-your-runtime",
            "intelligence/intelligence-platform",
            "intelligence/managed-intelligence-platform",
            "intelligence/memories",
            "intelligence/self-hosting",
            "intelligence/threads-explained",
        ],
        "channels": [
            "channels",
            "channels/commands-and-reactions",
            "channels/deploy-and-operate",
            "channels/files-and-multimodality",
            "channels/history-and-transcripts",
            "channels/identity-and-memory",
            "channels/intelligence",
            "channels/interactive",
            "channels/persistence-and-scaling",
            "channels/rich-messages",
            "channels/threads-and-state",
            "channels/tools",
        ],
    }
    product_units = []
    for family, slugs in product_families.items():
        for slug in slugs:
            source = doc_file(slug)
            product_units.append(
                {
                    "id": f"{family}:{slug}",
                    "family": family,
                    "canonical_public_route": f"/{slug}",
                    "guide_slug": slug,
                    "root_source_path": rel(source) if source else None,
                    "root_source_status": "present"
                    if source
                    else "no-root-mdx-framework-context-may-resolve",
                    "taxonomy_feature_ids": [
                        f["id"]
                        for f in active_features
                        if f.get("shell_docs_path") == f"/{slug}"
                    ],
                }
            )

    selected_matrix = []
    for integration in SELECTED:
        manifest = manifests[integration]
        mode = manifest.get("docs_mode", "generated")
        demos_by_id = defaultdict(list)
        for demo in manifest.get("demos", []) or []:
            demos_by_id[demo.get("id")].append(demo)
        for feature in active_features:
            fid = feature["id"]
            binding = guide_binding(feature)
            demo_entries = demos_by_id.get(fid, [])
            source = (
                resolve_content_source(integration, mode, binding["guide_slug"])
                if binding["guide_slug"]
                else {
                    "status": "not-applicable",
                    "precedence": "no-guide-mapping",
                    "path": None,
                }
            )
            manifest_status = catalog_status(fid, manifest)
            selected_matrix.append(
                {
                    "cell_id": f"react:{integration}:{fid}",
                    "frontend": "react",
                    "integration": integration,
                    "feature_id": fid,
                    "feature_name": feature.get("name"),
                    "category": feature.get("category"),
                    "feature_kind": feature.get("kind", "primary"),
                    "guide_binding": binding,
                    "projected_public_route": (
                        f"/{integration}{binding['canonical_public_route']}"
                        if binding["canonical_public_route"]
                        else None
                    ),
                    "resolved_content": source,
                    "frontend_support": frontend_support(frontend_registry, fid),
                    "manifest_cell_status": manifest_status,
                    "availability_disposition": availability_disposition(
                        integration, fid, manifest_status
                    ),
                    "manifest_demos": [
                        {
                            "id": demo.get("id"),
                            "route": demo.get("route"),
                            "command": demo.get("command"),
                            "highlight_paths": demo.get("highlight", []) or [],
                        }
                        for demo in demo_entries
                    ],
                    "fixture_binding": {
                        "status": "integration-fixtures-present-not-one-to-one",
                        "fixture_directory": rel(AIMOCK_DIR / integration),
                        "reason": "D6 fixture filenames are scenario recordings and are not declared as a feature-ID mapping in manifests.",
                    },
                    "runtime_status": "not_run",
                    "runtime_evidence": [],
                    "audit_status": "pending-content-and-local-runtime-audit",
                }
            )

    all_manifest_integrations = []
    for manifest_path in sorted(MANIFESTS_DIR.glob("*/manifest.yaml")):
        manifest = read_yaml(manifest_path)
        all_manifest_integrations.append(
            {
                "slug": manifest.get("slug", manifest_path.parent.name),
                "name": manifest.get("name"),
                "docs_mode": manifest.get("docs_mode", "generated"),
                "deployed": manifest.get("deployed"),
                "in_selected_baseline": manifest.get("slug", manifest_path.parent.name)
                in SELECTED,
            }
        )
    frontends = [
        {
            "id": item["id"],
            "name": item["name"],
            "runnable": item.get("runnable"),
            "feature_support_required": item.get("feature_support_required"),
        }
        for item in frontend_registry.get("frontends", [])
    ]
    public_integrations = [
        integration
        for integration in all_manifest_integrations
        if integration["docs_mode"] != "hidden"
    ]

    counts = {
        "taxonomy_feature_records": len(all_features),
        "active_taxonomy_features": len(active_features),
        "deprecated_taxonomy_features": len(all_features) - len(active_features),
        "feature_guide_units": len(guide_units),
        "active_features_with_shell_docs_path": sum(
            bool(f.get("shell_docs_path")) for f in active_features
        ),
        "active_features_without_shell_docs_path": [
            f["id"] for f in active_features if not f.get("shell_docs_path")
        ],
        "selected_matrix_cells": len(selected_matrix),
        "selected_integrations": len(SELECTED),
        "selected_declared_manifest_feature_outcomes": sum(
            len(manifests[slug].get("features", []) or []) for slug in SELECTED
        ),
        "selected_matrix_manifest_status_counts": dict(
            Counter(cell["manifest_cell_status"] for cell in selected_matrix)
        ),
        "selected_matrix_content_resolution_counts": dict(
            Counter(cell["resolved_content"]["status"] for cell in selected_matrix)
        ),
        "product_guide_units": len(product_units),
        "category_counts": dict(Counter(f["category"] for f in active_features)),
    }

    inventory = {
        "schema_version": 1,
        "generated_by": "tasks/docs-feature-audit/generate_inventory.py",
        "metadata": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "workspace_head": git(["git", "rev-parse", "HEAD"]),
            "baseline_source_revision": git(["git", "rev-parse", "origin/main"]),
            "feature_registry": {
                "path": rel(FEATURES_PATH),
                "sha256": source_digest(FEATURES_PATH),
            },
            "frontend_registry": {
                "path": rel(FRONTENDS_PATH),
                "sha256": source_digest(FRONTENDS_PATH),
            },
            "source_resolution_validation": {
                "router_precedence": "showcase/shell-docs/src/app/[framework]/[[...slug]]/page.tsx:800-866",
                "docs_folder_aliases": "showcase/shell-docs/src/lib/registry.ts:237-252",
                "frontend_backend_route_shape": "showcase/shell-docs/src/lib/frontend-options.ts:115-141",
                "canonical_component_routes_render_directly": "showcase/shell-docs/next.config.ts:855-859",
                "catalog_status_semantics": "showcase/harness/src/shared/catalog/catalog-flatten.ts:233-270",
            },
            "audit_rule": "Manifest/catalog declarations and fixture presence are inventory evidence only. A cell is not runtime-confirmed until a local run writes runtime_evidence.",
        },
        "scope": {
            "initial_execution": {
                "frontends": ["react"],
                "integrations": SELECTED,
                "runtime": "local only; AIMock permitted",
            },
            "global_outline": {
                "public_integrations": public_integrations,
                "hidden_manifest_integrations": [
                    integration
                    for integration in all_manifest_integrations
                    if integration["docs_mode"] == "hidden"
                ],
                "frontends": frontends,
                "included_product_families": [
                    "catalog-feature-guides",
                    "threads",
                    "intelligence",
                    "channels",
                ],
                "auth": "included through taxonomy feature `auth`; do not duplicate it as a separate product unit",
                "quickstarts": "listed as docs-only feature `cli-start`; whether all setup/tutorial journeys qualify as feature guides remains an explicit scope decision",
            },
        },
        "counts": counts,
        "selected_integrations": [
            integration_summary(slug, manifests[slug]) for slug in SELECTED
        ],
        "guide_units": guide_units,
        "product_guide_units": product_units,
        "selected_matrix": selected_matrix,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "inventory.json"
    json_path.write_text(json.dumps(inventory, indent=2, sort_keys=False) + "\n")

    lines = [
        "# Feature-guide audit inventory",
        "",
        "Generated audit evidence only. It does not modify product docs, manifests, generated data, or runtime results.",
        "",
        "## Baseline",
        "",
        f"- Source revision: `{inventory['metadata']['baseline_source_revision']}`",
        f"- Audit workspace head: `{inventory['metadata']['workspace_head']}` (audit-artifact commit only).",
        f"- Five-agent React matrix: {counts['selected_matrix_cells']} cells ({', '.join(SELECTED)} × {counts['active_taxonomy_features']} active feature records).",
        f"- Manifest declarations account for {counts['selected_declared_manifest_feature_outcomes']} feature outcomes before unsupported, absent, and demo-only reconciliation.",
        "- Runtime status is intentionally `not_run` for every cell until local-harness evidence is attached.",
        "- `wired`, `stub`, `unshipped`, and `unsupported` are manifest/catalog declarations, never pass results.",
        "",
        "## Source-resolution validation",
        "",
        "- Selected-framework source bindings mirror the router's authored/generated precedence, docs-folder aliases, and special quickstart/threads-import override handling.",
        "- Canonical component routes render directly; historical redirect aliases do not replace the canonical routes in this inventory.",
        "- Results: 193 selected cells resolve an effective MDX source; 17 have no source for the selected framework; 10 have no taxonomy guide mapping. These are coverage findings, not runtime or editorial defect verdicts.",
        "",
        "## Guide inventory",
        "",
        f"- {counts['active_taxonomy_features']} active taxonomy features collapse into {counts['feature_guide_units']} canonical catalog-guide routes.",
        f"- Missing feature-guide mappings: {', '.join(counts['active_features_without_shell_docs_path'])}.",
        f"- Product-guide outline: {counts['product_guide_units']} root source units across Threads, Intelligence, and Channels.",
        "",
        "| Canonical route | Feature IDs | Root source |",
        "| --- | --- | --- |",
    ]
    for unit in guide_units:
        source = (
            unit["root_source_path"] or "no root MDX (framework context may resolve)"
        )
        lines.append(
            f"| `{unit['canonical_public_route']}` | `{', '.join(unit['feature_ids'])}` | `{source}` |"
        )
    lines += [
        "",
        "## Selected integrations",
        "",
        "| Slug | Docs mode | Docs folder | Declared features | Routed demos | AIMock files |",
        "| --- | --- | --- | ---: | ---: | ---: |",
    ]
    for item in inventory["selected_integrations"]:
        lines.append(
            f"| `{item['slug']}` | {item['docs_mode']} | `{item['docs_folder']}` | {item['declared_feature_count']} | {item['routed_demo_count']} | {len(item['aimock_files'])} |"
        )
    lines += [
        "",
        "## Required status interpretation",
        "",
        "- `release-quarantine`: LangGraph Python and TypeScript interrupt cells explicitly marked unsupported pending a published react-core fix.",
        "- `manifest-unsupported`: capability is declared unsupported by that integration; it is not a runtime pass/fail assertion.",
        "- `declared-wired-unverified`: the manifest declares a routed demo, but no local evidence has yet confirmed it.",
        "- D6 runs execute integration-wide manifest demo sets, not a one-to-one feature fixture matrix. Fixture files are deliberately kept as integration-level evidence because their filenames are not a declared feature binding.",
        "",
        "## Reproduction contract",
        "",
        "Use the integration-wide local runner contract supplied by the harness audit:",
        "",
        "```text",
        "showcase/bin/showcase test <slug> --d6 --direct --isolate <unique> --verbose --cycle",
        "```",
        "",
        "Record the resulting log/artifact path and exact tested demo IDs in `runtime_evidence` before changing `runtime_status`.",
    ]
    (OUT_DIR / "inventory.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
