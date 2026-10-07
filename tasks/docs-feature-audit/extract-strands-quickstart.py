#!/usr/bin/env python3
"""Extract what a Python reader of the AWS Strands quickstart sees on the
"Use an existing agent" (bring-your-own) option, in document order.

Usage: extract-strands-quickstart.py [quickstart.mdx]

The page is showcase/shell-docs/src/content/docs/integrations/aws-strands/
quickstart.mdx, the folder `strands` resolves to through getDocsFolder()
(DOCS_FOLDER_OVERRIDES in showcase/shell-docs/src/lib/registry.ts).

Modelled on extract-lgp-quickstart-python.py. It simulates the docs Tabs
component (showcase/shell-docs/src/components/docs-tabs.tsx): every <Tabs>
with the same `groupId` shows the same tab. `language_strands_agent` is
Python, which the page shell pre-selects on /strands/* (TAB_DEFAULTS_BY_SLUG
in registry.ts); the package-manager group is read as npm. A <Tabs> whose
group has no selection shows its `default`, else its first item. Content
inside a non-selected <Tab> is hidden, at any nesting depth.

Each block also records the step heading it sits under and whether it sits
inside a <Callout> (the "Using Anthropic instead" alternative carries its own
`main.py` block, which a reader following the OpenAI path skips).

Output (JSON): {"raw_fenced_blocks": N, "visible": [...], "hidden": [...]},
each entry {index, lang, title, step, callout, tabs, body}. `tabs` is the list
of enclosing tab values. Bodies are dedented and have Fumadocs `[!code ...]`
annotations removed, as the rendered page shows them. visible + hidden must
equal raw_fenced_blocks; reproduce-strands-byoc-setup.sh checks that.
"""

import json
import re
import sys
import textwrap
from pathlib import Path

GUIDE = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "showcase/shell-docs/src/content/docs/integrations/aws-strands/quickstart.mdx"
)
SELECTED = {"language_strands_agent": "Python", "package-manager": "npm"}

text = GUIDE.read_text()
start = text.index('id="bring-your-own"')
end = text.index("</TailoredContentOption>", start)
lines = text[start:end].splitlines()

ANNOTATION = re.compile(r"\s*(#|//)\s*\[!code [^\]]*\]\s*$")
JSX_ANNOTATION = re.compile(r"^\s*\{/\*\s*\[!code [^\]]*\]\s*\*/\}\s*$")

tabs_stack = []  # open <Tabs>: {"group", "shown"}
tab_stack = []  # open <Tab>: {"value", "visible"}
callout_depth = 0
step = None
raw = 0
out = {"guide": str(GUIDE), "selected": SELECTED, "visible": [], "hidden": []}

i = 0
while i < len(lines):
    line = lines[i]
    heading = re.match(r"^\s*###\s+(.*\S)\s*$", line)
    if heading:
        step = heading.group(1)
    callout_depth += len(re.findall(r"<Callout\b", line))
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
    fence = re.match(r"^(\s*)```(\S*)(.*)$", line)
    if fence:
        raw += 1
        lang, info = fence.group(2), fence.group(3).strip()
        body = []
        i += 1
        while not re.match(r"^\s*```\s*$", lines[i]):
            body.append(lines[i])
            i += 1
        dedented = textwrap.dedent("\n".join(body))
        kept = []
        for b in dedented.splitlines():
            if JSX_ANNOTATION.match(b):
                continue
            stripped = ANNOTATION.sub("", b)
            if b.strip() and not stripped.strip():
                continue  # the line held only an annotation
            kept.append(stripped)
        title = re.search(r'title="([^"]+)"', info)
        entry = {
            "lang": lang,
            "title": title.group(1) if title else None,
            "step": step,
            "callout": callout_depth > 0,
            "tabs": [t["value"] for t in tab_stack],
            "body": "\n".join(kept).rstrip("\n") + "\n",
        }
        bucket = "visible" if all(t["visible"] for t in tab_stack) else "hidden"
        entry["index"] = len(out[bucket])
        out[bucket].append(entry)
    callout_depth -= len(re.findall(r"</Callout>", line))
    i += 1

out["raw_fenced_blocks"] = raw
json.dump(out, sys.stdout, indent=1)
print()
