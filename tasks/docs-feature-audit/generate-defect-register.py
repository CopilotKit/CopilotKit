#!/usr/bin/env python3
"""Generate the human-readable defect register from the canonical JSON record."""

from collections import OrderedDict
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name("content-defects.json")
OUTPUT = Path(__file__).with_name("defect-register.md")

FRAMEWORKS = OrderedDict(
    [
        ("langgraph-python", "LangGraph Python"),
        ("langgraph-typescript", "LangGraph TypeScript"),
        ("langgraph-fastapi", "LangGraph FastAPI"),
        ("google-adk", "Google ADK"),
        ("built-in-agent", "Built-in Agent"),
        ("aws-strands", "AWS Strands"),
        ("strands-typescript", "Strands TypeScript"),
        ("strands", "Strands"),
        ("claude-sdk-python", "Claude SDK Python"),
        ("claude-sdk-typescript", "Claude SDK TypeScript"),
        ("crewai", "CrewAI Flows"),
        ("llamaindex", "LlamaIndex"),
        ("mastra", "Mastra"),
        ("ms-agent-dotnet", "Microsoft Agent Framework .NET"),
        ("ms-agent-harness-dotnet", "Microsoft Agent Framework Harness .NET"),
        ("ms-agent-python", "Microsoft Agent Framework Python"),
        ("microsoft-agent-framework", "Microsoft Agent Framework"),
        ("pydantic-ai", "Pydantic AI"),
        ("ag2", "AG2"),
        ("agno", "AGNO"),
        ("angular", "Angular"),
        ("react-native", "React Native"),
        ("vue", "Vue"),
        ("react", "React"),
        ("channels", "Channels"),
        ("intelligence", "Intelligence"),
        ("threads", "Threads"),
    ]
)


def link(path: str, line: int | None) -> str:
    target = (ROOT / path).resolve()
    suffix = f":{line}" if isinstance(line, int) else ""
    return f"[`{path}{suffix}`]({target}{suffix})"


def affected_frameworks(contexts: list[str]) -> str:
    text = " ".join(contexts).lower()
    found = [
        label
        for token, label in FRAMEWORKS.items()
        if token in text and not (token == "strands" and "strands-typescript" in text)
    ]
    # Preserve context families that do not encode a framework slug.
    if any(item.startswith("product/") for item in contexts):
        found.append("Product guides")
    return ", ".join(dict.fromkeys(found)) or "Cross-cutting docs/runtime"


def evidence_kind(evidence: list[dict]) -> str:
    paths = [str(item.get("path", "")) for item in evidence]
    has_runtime = any(
        path.startswith("tasks/docs-feature-audit/") or path.endswith(".log")
        for path in paths
    )
    has_source = any(
        path.startswith(("showcase/", "packages/", "examples/")) for path in paths
    )
    if has_source and has_runtime:
        return "source + local audit evidence"
    if has_runtime:
        return "local audit evidence"
    return "source/static analysis"


def one_line(text: str) -> str:
    return " ".join(text.split())


def main() -> None:
    data = json.loads(SOURCE.read_text())
    defects = data["defects"]
    confirmed = sum(item["status"] == "confirmed" for item in defects)
    triaged = sum(item["status"] == "triaged" for item in defects)
    candidate = sum(item["status"] == "candidate" for item in defects)
    lines = [
        "# Documentation and Showcase defect register",
        "",
        "Generated from `content-defects.json`. It is a reviewer index: the JSON remains the canonical record with every affected context and full evidence.",
        "",
        f"- Records: {len(defects)} ({confirmed} confirmed, {triaged} triaged, {candidate} candidate).",
        "- Global unique-source review: 81/81 units reviewed; all 405 canonical routes and 978 represented frontend bindings are covered by the deduplicated source inventory.",
        "- Local rendered-marker audit: 64 HTML paths and 112 impacted context cells. Frontend (38 supported / 74 not-declared) and backend (85 declared-wired / 24 unshipped / 3 manifest-unsupported) are overlapping dimensions, not additive totals.",
        "- The supported-and-wired intersection is 29 cells. It is the scope for rendered Missing snippet defects; it neither promotes undeclared/unshipped cells nor negates the separately confirmed Google ADK source-resolution defect outside this probe subset.",
        "- “External viewer” records describe a repository-ownership/context gap. They do not claim that the remote viewer is unavailable.",
        "",
        "## Records",
        "",
    ]
    for item in defects:
        severity = str(item.get("severity", "unspecified")).capitalize()
        status = item.get("status", "unknown")
        lines.extend(
            [
                f"### {item['id']} — {severity} · {status}",
                "",
                one_line(
                    item.get("impact")
                    or item.get("root_cause")
                    or item.get("feature", "")
                ),
                "",
                f"- **Area:** {item.get('area', 'unspecified')}",
                f"- **Affected frameworks:** {affected_frameworks(item.get('affected_contexts', []))} ({len(item.get('affected_contexts', []))} recorded contexts)",
                f"- **Evidence:** {evidence_kind(item.get('source_evidence', []))}",
            ]
        )
        evidence = item.get("source_evidence", [])
        if evidence:
            runtime = [
                entry
                for entry in evidence
                if str(entry.get("path", "")).startswith("tasks/docs-feature-audit/")
                or str(entry.get("path", "")).endswith(".log")
            ]
            source = [entry for entry in evidence if entry not in runtime]
            chosen = (source[:1] + runtime[:1]) if runtime else evidence[:2]
            lines.append(
                f"- **Primary links:** {', '.join(link(str(entry['path']), entry.get('line')) for entry in chosen)}"
            )
        if item.get("resolution"):
            lines.append(f"- **Resolution:** {one_line(item['resolution'])}")
        lines.append(
            f"- **Full record:** [`content-defects.json` entry]({SOURCE.resolve()})"
        )
        lines.append("")
    OUTPUT.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
