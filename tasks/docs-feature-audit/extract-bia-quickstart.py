#!/usr/bin/env python3
"""List the fenced code blocks of the Built-in Agent quickstart as a reader sees them.

usage: extract-bia-quickstart.py <quickstart.mdx>

The Built-in Agent is shell-docs' ROOT_FRAMEWORK, so its authored quickstart
(showcase/shell-docs/src/content/docs/integrations/built-in-agent/quickstart.mdx)
is the page served at the root /quickstart; /built-in-agent/* redirects there.

Simulates what the page renders by default:
  * <Tabs groupId="package-manager"> shows its first item (npm); blocks in the
    pnpm / yarn / bun tabs are hidden.
  * <FrontendOnly frontend="X"> renders only for the selected frontend; the
    default is react, so frontend="angular" content is hidden.
  * A ```npm fence is fumadocs' package-manager block; its npm form is the one
    shown by default, so it is visible as an npm command.
  * Blocks inside a <Callout> are visible but flagged, so callers can skip
    side-note code.
Annotation comments (// [!code ...], {/* [!code ...] */}) are stripped, and
the block body is dedented. Prints JSON:
  {"raw_fenced_blocks": N, "visible": [...], "hidden": [...]}
Each block: index, lang, title, step (the enclosing ### heading), tabs (the
enclosing tab values), frontend (enclosing FrontendOnly value or null),
callout (bool), body.
"""

import json
import re
import sys
import textwrap

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().split("\n")

FENCE = re.compile(r"^(\s*)```(\S*)(.*)$")
ANNOT = [
    re.compile(r"\s*//\s*\[!code [^\]]*\]\s*,?"),  # trailing // [!code highlight]
    re.compile(r"^\s*\{/\*\s*\[!code [^\]]*\]\s*\*/\}\s*$"),  # whole-line JSX comment
]

step = None
tab_stack = []  # (groupId, items, current value)
frontend_stack = []
callout_depth = 0
blocks = []
i = 0
raw = 0
while i < len(lines):
    line = lines[i]
    s = line.strip()
    m = FENCE.match(line)
    if m:
        indent, lang, rest = m.group(1), m.group(2), m.group(3)
        raw += 1
        title_m = re.search(r'title="([^"]*)"', rest)
        body_lines = []
        i += 1
        while i < len(lines) and not re.match(r"^\s*```\s*$", lines[i]):
            body_lines.append(lines[i])
            i += 1
        body = textwrap.dedent("\n".join(body_lines))
        cleaned = []
        for bl in body.split("\n"):
            if ANNOT[1].match(bl):
                continue
            cleaned.append(ANNOT[0].sub("", bl).rstrip())
        tabs = [t[2] for t in tab_stack]
        frontend = frontend_stack[-1] if frontend_stack else None
        hidden = any(t[2] != t[1][0] for t in tab_stack) or (
            frontend is not None and frontend != "react"
        )
        blocks.append(
            {
                "index": raw,
                "lang": lang or "",
                "title": title_m.group(1) if title_m else None,
                "step": step,
                "tabs": tabs,
                "frontend": frontend,
                "callout": callout_depth > 0,
                "hidden": hidden,
                "body": "\n".join(cleaned).strip("\n") + "\n",
            }
        )
        i += 1
        continue
    h = re.match(r"^#{2,3}\s+(.*)$", s)
    if h:
        step = h.group(1).strip()
    t = re.match(r"<Tabs\b.*?groupId=\"([^\"]*)\".*?items=\{\[(.*?)\]\}", s)
    if t:
        items = re.findall(r"['\"]([^'\"]+)['\"]", t.group(2))
        tab_stack.append([t.group(1), items, None])
    tv = re.match(r"<Tab\s+value=\"([^\"]*)\"", s)
    if tv and tab_stack:
        tab_stack[-1][2] = tv.group(1)
    if s.startswith("</Tabs>") and tab_stack:
        tab_stack.pop()
    fo = re.match(r"<FrontendOnly\s+frontend=\"([^\"]*)\"", s)
    if fo:
        frontend_stack.append(fo.group(1))
    if s.startswith("</FrontendOnly>") and frontend_stack:
        frontend_stack.pop()
    if s.startswith("<Callout"):
        callout_depth += 1
    if s.startswith("</Callout>"):
        callout_depth -= 1
    i += 1

out = {
    "raw_fenced_blocks": raw,
    "visible": [
        {k: v for k, v in b.items() if k != "hidden"} for b in blocks if not b["hidden"]
    ],
    "hidden": [
        {k: v for k, v in b.items() if k != "hidden"} for b in blocks if b["hidden"]
    ],
}
json.dump(out, sys.stdout, indent=2)
print()
