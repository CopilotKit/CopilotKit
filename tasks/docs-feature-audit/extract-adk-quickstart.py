#!/usr/bin/env python3
"""Extract the ADK quickstart's bring-your-own path, verbatim.

Reads showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx
(the page google-adk resolves to through getDocsFolder() in
showcase/shell-docs/src/lib/registry.ts), isolates the `bring-your-own`
TailoredContentOption ("Use an existing agent"), and prints every fenced block
in document order as JSON: its info string (lang, title), the step heading it
sits under, the package-manager tab it sits in (npm / pnpm / yarn / bun, or
null) and its body.

The body is dedented and has Fumadocs `[!code ...]` annotation comments
removed, which is what the rendered page shows a reader.
reproduce-adk-byoc-setup.sh runs these blocks instead of a hand-copied
transcription, so the reproduction follows the guide as written.
"""

import json
import re
import sys
import textwrap
from pathlib import Path

GUIDE = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx"
)
text = GUIDE.read_text()

start = text.index('id="bring-your-own"')
end = text.index("</TailoredContentOption>", start)
region = text[start:end].splitlines()

ANNOTATION = re.compile(r"\s*(#|//)\s*\[!code [^\]]*\]\s*$")
JSX_ANNOTATION = re.compile(r"^\s*\{/\*\s*\[!code [^\]]*\]\s*\*/\}\s*$")

blocks = []
tab = None
step = None
i = 0
while i < len(region):
    line = region[i]
    heading = re.match(r"^\s*###\s+(.*\S)\s*$", line)
    if heading:
        step = heading.group(1)
    m = re.search(r'<Tab value="([^"]+)">', line)
    if m:
        tab = m.group(1)
    if "</Tabs>" in line:
        tab = None
    fence = re.match(r"^(\s*)```(\S*)(.*)$", line)
    if fence:
        lang, info = fence.group(2), fence.group(3).strip()
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
                "step": step,
                "tab": tab,
                "body": "\n".join(lines).rstrip("\n") + "\n",
            }
        )
    i += 1

json.dump(blocks, sys.stdout, indent=1)
print()
