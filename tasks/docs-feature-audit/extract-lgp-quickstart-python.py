#!/usr/bin/env python3
"""Extract the LangGraph quickstart's bring-your-own Python tab, verbatim.

Reads showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx,
isolates the `bring-your-own` option's Python tab, and prints every fenced
block in document order as JSON: its info string, its deployment tab
(LangSmith / FastAPI / both) and its body. The body is dedented and has
Fumadocs `[!code ...]` annotation comments removed, which is what the rendered
page shows a reader. reproduce-lgp-byoc-setup.sh runs these blocks instead of
a hand-copied transcription, so the reproduction follows the guide as written.
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
text = GUIDE.read_text()

start = text.index('id="bring-your-own"')
py_start = text.index('<Tab value="Python">', start)
py_end = text.index('<Tab value="TypeScript">', py_start)
region = text[py_start:py_end].splitlines()

ANNOTATION = re.compile(r"\s*(#|//)\s*\[!code [^\]]*\]\s*$")
JSX_ANNOTATION = re.compile(r"^\s*\{/\*\s*\[!code [^\]]*\]\s*\*/\}\s*$")

blocks = []
tab = "both"
depth_tab = None
i = 0
while i < len(region):
    line = region[i]
    m = re.search(r'<Tab value="(LangSmith|FastAPI)">', line)
    if m:
        tab = m.group(1)
    if "</Tabs>" in line and tab != "both":
        tab = "both"
    fence = re.match(r"^(\s*)```(\S*)(.*)$", line)
    if fence:
        indent, lang, info = fence.group(1), fence.group(2), fence.group(3).strip()
        body = []
        i += 1
        while not re.match(r"^\s*```\s*$", region[i]):
            body.append(region[i])
            i += 1
        raw = textwrap.dedent("\n".join(body))
        lines = []
        for b in raw.splitlines():
            if JSX_ANNOTATION.match(b):
                continue
            stripped = ANNOTATION.sub("", b)
            if b.strip() and not stripped.strip():
                continue  # the line held only an annotation
            lines.append(stripped)
        title = re.search(r'title="([^"]+)"', info)
        blocks.append(
            {
                "index": len(blocks),
                "lang": lang,
                "title": title.group(1) if title else None,
                "tab": tab,
                "body": "\n".join(lines).rstrip("\n") + "\n",
            }
        )
    i += 1

json.dump(blocks, sys.stdout, indent=1)
print()
