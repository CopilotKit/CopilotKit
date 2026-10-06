#!/usr/bin/env python3
"""Extract what a Python reader of the LangGraph quickstart sees on the
"Use an existing agent" (bring-your-own) option, in document order.

Usage: extract-lgp-quickstart-python.py [quickstart.mdx] [LangSmith|FastAPI]

Rewritten 2026-10-06. The 2026-09-23 version took the text between the first
`<Tab value="Python">` and the next `<Tab value="TypeScript">`. Since the
2026-09-30 per-step language tabs (5895f8030c) and the TypeScript
existing-agent restructure (7256775c4c) that region holds only the `uv init`
block, so the reproduction stopped at its second step.

This version simulates the docs Tabs component
(showcase/shell-docs/src/components/docs-tabs.tsx), as
extract-lgts-quickstart.py does for TypeScript: every <Tabs> with the same
`groupId` shows the same tab. `language_langgraph_agent` is Python, which the
page shell pre-selects on /langgraph-python/* and /langgraph-fastapi/*
(TAB_DEFAULTS_BY_SLUG in showcase/shell-docs/src/lib/registry.ts).
`deployment_method` is the second argument: LangSmith is pre-selected on
/langgraph-python/*, FastAPI on /langgraph-fastapi/* (and either is one click
away on both). The package-manager group is read as npm. A <Tabs> whose group
has no selection shows its `default`, else its first item. Content inside a
non-selected <Tab> is hidden, at any nesting depth.

Output (JSON): {"deployment": ..., "visible": [...], "hidden_python": [...]},
each entry a fenced block {index, kind: "code", lang, title, body} or a
Snippet {kind: "snippet", attrs}. Bodies are dedented and have Fumadocs
`[!code ...]` annotations removed, as the rendered page shows them.
`hidden_python` lists blocks that sit in a Python tab or in this reader's
deployment tab but are hidden from this reader.
"""

import json
import re
import sys
import textwrap
from pathlib import Path

GUIDE = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx"
)
DEPLOYMENT = sys.argv[2] if len(sys.argv) > 2 else "LangSmith"
if DEPLOYMENT not in ("LangSmith", "FastAPI"):
    sys.exit(f"deployment tab must be LangSmith or FastAPI, not {DEPLOYMENT!r}")
SELECTED = {
    "language_langgraph_agent": "Python",
    "deployment_method": DEPLOYMENT,
    "package-manager": "npm",
}
text = GUIDE.read_text()
start = text.index('id="bring-your-own"')
end = text.index("</TailoredContentOption>", start)
lines = text[start:end].splitlines()

ANNOTATION = re.compile(r"\s*(#|//)\s*\[!code [^\]]*\]\s*$")
JSX_ANNOTATION = re.compile(r"^\s*\{/\*\s*\[!code [^\]]*\]\s*\*/\}\s*$")

# Stack of open <Tabs>: {"group", "shown"}; stack of open <Tab>: {"value", "visible"}.
tabs_stack = []
tab_stack = []


def visible():
    return all(t["visible"] for t in tab_stack)


def in_python_tab():
    return any(t["value"] in ("Python", DEPLOYMENT) for t in tab_stack)


out = {"deployment": DEPLOYMENT, "visible": [], "hidden_python": []}
i = 0
while i < len(lines):
    line = lines[i]
    m = re.search(r"<Tabs\b([^>]*)>", line)
    if m:
        attrs = m.group(1)
        group = re.search(r'groupId="([^"]+)"', attrs)
        group = group.group(1) if group else None
        items = re.search(r"items=\{\[([^\]]*)\]\}", attrs)
        items = re.findall(r"'([^']*)'|\"([^\"]*)\"", items.group(1)) if items else []
        items = [a or b for a, b in items]
        default = re.search(r'default="([^"]+)"', attrs)
        shown = (
            SELECTED.get(group)
            or (default.group(1) if default else None)
            or (items[0] if items else None)
        )
        tabs_stack.append({"group": group, "shown": shown})
    m = re.search(r'<Tab value="([^"]+)">', line)
    if m:
        value = m.group(1)
        tab_stack.append({"value": value, "visible": tabs_stack[-1]["shown"] == value})
    if re.search(r"</Tab>", line) and not re.search(r"</Tabs>", line):
        tab_stack.pop()
    if re.search(r"</Tabs>", line):
        tabs_stack.pop()
    snip = re.search(r"<Snippet\b", line)
    if snip:
        body = [line]
        while "/>" not in lines[i]:
            i += 1
            body.append(lines[i])
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', " ".join(body)))
        entry = {"kind": "snippet", "attrs": attrs}
        if visible():
            out["visible"].append(entry)
        elif in_python_tab():
            out["hidden_python"].append(entry)
    fence = re.match(r"^(\s*)```(\S*)(.*)$", line)
    if fence:
        lang, info = fence.group(2), fence.group(3).strip()
        body = []
        i += 1
        while not re.match(r"^\s*```\s*$", lines[i]):
            body.append(lines[i])
            i += 1
        raw = textwrap.dedent("\n".join(body))
        kept = []
        for b in raw.splitlines():
            if JSX_ANNOTATION.match(b):
                continue
            stripped = ANNOTATION.sub("", b)
            if b.strip() and not stripped.strip():
                continue
            kept.append(stripped)
        title = re.search(r'title="([^"]+)"', info)
        entry = {
            "kind": "code",
            "lang": lang,
            "title": title.group(1) if title else None,
            "body": "\n".join(kept).rstrip("\n") + "\n",
        }
        if visible():
            entry["index"] = len(out["visible"])
            out["visible"].append(entry)
        elif in_python_tab():
            out["hidden_python"].append(entry)
    i += 1

json.dump(out, sys.stdout, indent=1)
print()
