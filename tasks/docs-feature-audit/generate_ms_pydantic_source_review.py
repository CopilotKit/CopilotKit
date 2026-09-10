#!/usr/bin/env python3
"""Produce a bounded review record for pending Microsoft Agent Framework/Pydantic AI guide units."""

import json
from collections import Counter
from pathlib import Path

OUT = Path(__file__).parent
TARGETS = {
    "ms-agent-dotnet",
    "ms-agent-harness-dotnet",
    "ms-agent-python",
    "pydantic-ai",
}
DETAILS = {
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/auth.mdx": (
        "reviewed-no-new-defect",
        "Read both .NET and Python setup paths against the integration's declared framework variants; authentication boundary and explicit production warning are coherent.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/custom-look-and-feel/slots.mdx": (
        "reviewed-no-new-defect",
        "Thin wrapper correctly delegates the framework-agnostic React slots guide through the docs registry.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/frontend-tools.mdx": (
        "context-gap",
        "The guide is bound to both .NET and Python cells but its only demo/code surface is an external .NET Feature Viewer. It supplies no local exact Python binding; external content was intentionally not fetched.",
        [
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/frontend-tools.mdx:6-14",
            "showcase/shell-docs/src/content/snippets/integrations/microsoft-agent-framework/run-and-connect.mdx:10-17",
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema.mdx": (
        "confirmed-context-defect",
        "The shared guide instructs every mapped MAF context to use auto-injection, but the checked-in .NET runtime explicitly requires injectA2UITool false while the Python runtime uses true. The page needs a per-agent distinction before it can be copyable for both bindings.",
        [
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema.mdx:16-27",
            "showcase/integrations/ms-agent-dotnet/src/app/api/copilotkit-declarative-gen-ui/route.ts:3-5",
            "showcase/integrations/ms-agent-dotnet/src/app/api/copilotkit-declarative-gen-ui/route.ts:27-39",
            "showcase/integrations/ms-agent-python/src/app/api/copilotkit-declarative-gen-ui/route.ts:33-45",
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/a2ui/fixed-schema.mdx": (
        "reviewed-no-new-defect",
        "The page labels its Python-specific SDK limitation and its fixed-schema runtime policy agrees with the checked-in fixed-schema runtime direction. No independent inconsistency found.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/mcp-apps.mdx": (
        "reviewed-no-new-defect",
        "Thin wrapper correctly delegates the shared MCP Apps documentation surface.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx": (
        "confirmed-copy-paste-defect",
        "The backend examples name search_agent while both frontend useAgent examples select sample_agent, so the supplied frontend will not subscribe to the documented agent. The demo is also an external .NET viewer for a page mapped to Python; that context gap is recorded separately from the copy-paste failure.",
        [
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:320",
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:382",
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:426",
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx:7-14",
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/tool-rendering.mdx": (
        "context-gap",
        "The only demo and code links are external Feature Viewer URLs, despite the local guide being mapped to .NET and Python. This is recorded as unverified external presentation, not an asserted remote outage.",
        [
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/tool-rendering.mdx:7-28"
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/display-only.mdx": (
        "reviewed-no-new-defect",
        "Thin wrapper delegates the shared display-only surface with the docs component registry.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/interactive.mdx": (
        "confirmed-context-defect",
        "This unit maps to ms-agent-python as well as .NET, but hard-codes the .NET Feature Viewer framework argument. The Python route therefore cannot present its own exact demo/context.",
        [
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/generative-ui/your-components/interactive.mdx:6-8",
            "showcase/shell-docs/src/content/snippets/shared/generative-ui/interactive.mdx:3-10",
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/human-in-the-loop/index.mdx": (
        "context-gap",
        "The cards use unscoped root URLs, which resolve outside the mapped MAF integration context. Treat as context loss, not a missing-page claim.",
        [
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/human-in-the-loop/index.mdx:19-36"
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/quickstart.mdx": (
        "context-gap",
        "The quickstart is shared by .NET, harness .NET, and Python, but its next-step cards use the unscoped microsoft-agent-framework path. Local redirect verification sends that family path to the .NET quickstart, so Python/harness context is lost.",
        [
            "showcase/shell-docs/src/content/docs/integrations/microsoft-agent-framework/quickstart.mdx:522-540",
            "showcase/shell-docs/src/content/snippets/integrations/microsoft-agent-framework/run-and-connect.mdx:10-17",
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/custom-look-and-feel/slots.mdx": (
        "reviewed-no-new-defect",
        "Thin wrapper correctly delegates the framework-agnostic React slots surface.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/frontend-tools.mdx": (
        "reviewed-no-new-defect",
        "The Pydantic AI framework argument is passed to the shared frontend-tools snippet; no source-level mismatch found.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/mcp-apps.mdx": (
        "reviewed-no-new-defect",
        "Thin wrapper correctly delegates the shared MCP Apps surface.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx": (
        "confirmed-copy-paste-defect",
        "The first implementation fence is declared Python agent.py but contains TypeScript/JSX and useAgent; it cannot run as presented. Its iframe also points to LangGraph, so it is not Pydantic AI evidence.",
        [
            "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx:7-14",
            "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/state-rendering.mdx:34-71",
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/tool-rendering.mdx": (
        "context-gap",
        "The Pydantic AI guide embeds and describes LangGraph Feature Viewer URLs rather than a Pydantic AI example. Remote viewer availability was not requested or asserted.",
        [
            "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/tool-rendering.mdx:12-23"
        ],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/your-components/display-only.mdx": (
        "reviewed-no-new-defect",
        "The registry-provided display-only surface is used consistently; no standalone source mismatch found.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/generative-ui/your-components/interactive.mdx": (
        "reviewed-no-new-defect",
        "The shared interactive guide receives the Pydantic AI framework identifier.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/human-in-the-loop.mdx": (
        "reviewed-no-new-defect",
        "The Pydantic AI-specific viewer identifier and AG-UI adapter example are internally aligned; external viewer content was not fetched.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/quickstart.mdx": (
        "reviewed-no-new-defect",
        "Read the AG-UI adapter, runtime, provider, and startup sequence; no independent source inconsistency found.",
        [],
    ),
    "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/shared-state/index.mdx": (
        "reviewed-no-new-defect",
        "The shared-state overview correctly limits itself to concept/setup context and does not make a conflicting API claim.",
        [],
    ),
}


def main():
    pending = json.loads((OUT / "global-pending-source-units.json").read_text())[
        "units"
    ]
    units = []
    for unit in pending:
        path = unit["path"]
        if (
            unit["review_status"] != "pending-manual-content-review"
            or path not in DETAILS
        ):
            continue
        relevant = sorted(set(unit["integrations"]) & TARGETS)
        if not relevant:
            continue
        status, note, citations = DETAILS[path]
        units.append(
            {
                "path": path,
                "integrations": relevant,
                "feature_ids": unit["feature_ids"],
                "cell_count": unit["cell_count"],
                "review_status": status,
                "review_note": note,
                "citations": citations,
            }
        )
    expected = set(DETAILS)
    actual = {unit["path"] for unit in units}
    if actual != expected:
        raise SystemExit(
            f"review unit mismatch: missing={sorted(expected - actual)} unexpected={sorted(actual - expected)}"
        )
    counts = Counter(unit["review_status"] for unit in units)
    output = {
        "schema_version": 1,
        "product_source_baseline": "fa6041fc7b08fc5866099769038e43c44c1ce8df",
        "scope": "All pending Microsoft Agent Framework and Pydantic AI guide source units from global-pending-source-units.json. Local/source review only; external iframe destinations were not fetched.",
        "counts": {
            "units": len(units),
            "cells": sum(unit["cell_count"] for unit in units),
            "by_review_status": dict(sorted(counts.items())),
        },
        "units": units,
    }
    (OUT / "global-source-review-ms-pydantic.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )
    lines = [
        "# Microsoft Agent Framework and Pydantic AI source review",
        "",
        output["scope"],
        "",
        f"- Units reviewed: {len(units)}.",
        f"- Bound cells represented: {output['counts']['cells']}.",
        f"- Statuses: {', '.join(f'{k}={v}' for k, v in sorted(counts.items()))}.",
        "",
        "## Confirmed source findings",
        "",
    ]
    for unit in units:
        if unit["review_status"].startswith("confirmed"):
            lines += [
                f"- `{unit['path']}` — {unit['review_note']}",
                *[f"  - `{citation}`" for citation in unit["citations"]],
            ]
    lines += ["", "## Context gaps", ""]
    for unit in units:
        if unit["review_status"] == "context-gap":
            lines += [
                f"- `{unit['path']}` — {unit['review_note']}",
                *[f"  - `{citation}`" for citation in unit["citations"]],
            ]
    (OUT / "global-source-review-ms-pydantic.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
