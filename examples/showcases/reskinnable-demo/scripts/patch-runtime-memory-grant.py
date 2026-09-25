"""
Apply PR #7352 to the reskinnable demo's INSTALLED @copilotkit/runtime.

The demo pins a published canary (1.68.3-canary.*) while the fix landed on main
(1.73.0), so swapping the whole package would drag five minors of unrelated
change into a demo that also pins @ag-ui/* to that same canary line. The dist
ships one unminified file per source module, so the three changed modules can be
patched in place instead — the same change, with no version movement.

ESM and CJS are emitted separately and call across modules differently (bare
import vs `require_memory_policy.` namespace), so each format gets its own
needles. Both are patched: the package's export map picks per condition, and a
half-patched install would behave differently depending on who imported it.

This edits node_modules. Any reinstall wipes it. It is a bridge until the fix
ships in a canary, not a substitute for the release.

Idempotent: re-running detects the applied form and leaves it alone.
"""

import pathlib
import sys

BASE = pathlib.Path(
    "/Volumes/Projects/CLIENTS/CopilotKit/CopilotKit/examples/showcases/"
    "reskinnable-demo/node_modules/@copilotkit/runtime/dist/v2/runtime"
).resolve()

MARKER = "grantAllowsMemory"

HELPER = '''const NO_MEMORY = {
\tuser: "none",
\tproject: "none"
};
function grantAllowsMemory(grant) {
\treturn grant.user !== "none" || grant.project !== "none";
}
'''

ACCESS_SET = 'const ACCESS = new Set([\n\t"none",\n\t"read",\n\t"read-write"\n]);'

OLD_POLICY_BODY = (
    '\t\tif (grant === null || grant.user === "none" && grant.project === "none") '
    'return errorResponse("Memory access denied", 403);\n'
    '\t\tif (!ACCESS.has(grant.user) || !ACCESS.has(grant.project)) '
    'return errorResponse("Memory policy returned an invalid grant", 500);\n'
    '\t\treturn {\n\t\t\tuser,\n\t\t\tgrant: {\n\t\t\t\tuser: grant.user,'
    '\n\t\t\t\tproject: grant.project\n\t\t\t}\n\t\t};'
)

NEW_POLICY_BODY = (
    '\t\tconst resolved = grant ?? NO_MEMORY;\n'
    '\t\tif (!ACCESS.has(resolved.user) || !ACCESS.has(resolved.project)) '
    'return errorResponse("Memory policy returned an invalid grant", 500);\n'
    '\t\treturn {\n\t\t\tuser,\n\t\t\tgrant: {\n\t\t\t\tuser: resolved.user,'
    '\n\t\t\t\tproject: resolved.project\n\t\t\t}\n\t\t};'
)


def policy_edits(ext):
    """memory-policy: stop refusing, add and export the predicate."""
    edits = [
        (ACCESS_SET, ACCESS_SET + "\n" + HELPER),
        (OLD_POLICY_BODY, NEW_POLICY_BODY),
    ]
    if ext == "mjs":
        # The CJS body references errorResponse through its namespace alias.
        edits.append(
            ("export { resolveWebMemory };", "export { grantAllowsMemory, resolveWebMemory };")
        )
    else:
        edits = [
            (ACCESS_SET, ACCESS_SET + "\n" + HELPER),
            (
                OLD_POLICY_BODY.replace("errorResponse(", "require_json_response.errorResponse("),
                NEW_POLICY_BODY.replace("errorResponse(", "require_json_response.errorResponse("),
            ),
            (
                "exports.resolveWebMemory = resolveWebMemory;",
                "exports.grantAllowsMemory = grantAllowsMemory;\nexports.resolveWebMemory = resolveWebMemory;",
            ),
        ]
    return edits


def agent_edits(ext):
    """agent-utils: a grant of nothing skips the tools, it does not fail the run."""
    call = "resolveWebMemory" if ext == "mjs" else "require_memory_policy.resolveWebMemory"
    pred = "grantAllowsMemory" if ext == "mjs" else "require_memory_policy.grantAllowsMemory"
    old = (
        f'\tconst access = await {call}(runtime, request, userResult, "agent");\n'
        "\tif (access instanceof Response) return access;\n"
        "\tagent.use("
    )
    new = (
        f'\tconst access = await {call}(runtime, request, userResult, "agent");\n'
        "\tif (access instanceof Response) return access;\n"
        f"\tif (runtime.memory && !{pred}(access.grant)) return;\n"
        "\tagent.use("
    )
    edits = [(old, new)]
    if ext == "mjs":
        edits.append(
            (
                'import { resolveWebMemory } from "./memory-policy.mjs";',
                'import { grantAllowsMemory, resolveWebMemory } from "./memory-policy.mjs";',
            )
        )
    return edits


def memories_edits(ext):
    """memories: these routes exist to serve memories, so they keep refusing."""
    call = "resolveWebMemory" if ext == "mjs" else "require_memory_policy.resolveWebMemory"
    pred = "grantAllowsMemory" if ext == "mjs" else "require_memory_policy.grantAllowsMemory"
    guard = "isHandlerResponse" if ext == "mjs" else "require_json_response.isHandlerResponse"
    err = "errorResponse" if ext == "mjs" else "require_json_response.errorResponse"
    old = f'\treturn {call}(runtime, request, user, "client");'
    new = (
        f'\tconst access = await {call}(runtime, request, user, "client");\n'
        f"\tif ({guard}(access)) return access;\n"
        f'\tif (runtime.memory && !{pred}(access.grant)) return {err}("Memory access denied", 403);\n'
        "\treturn access;"
    )
    edits = [(old, new)]
    if ext == "mjs":
        edits.append(
            (
                'import { resolveWebMemory } from "../shared/memory-policy.mjs";',
                'import { grantAllowsMemory, resolveWebMemory } from "../shared/memory-policy.mjs";',
            )
        )
    return edits


TARGETS = [
    ("handlers/shared/memory-policy", policy_edits),
    ("handlers/shared/agent-utils", agent_edits),
    ("handlers/intelligence/memories", memories_edits),
]

changed, skipped, failures = [], [], []

for ext in ("mjs", "cjs"):
    for rel, build in TARGETS:
        path = BASE / f"{rel}.{ext}"
        if not path.exists():
            failures.append(f"missing file: {path}")
            continue
        text = original = path.read_text()
        if MARKER in text:
            skipped.append(f"{rel}.{ext} (already patched)")
            continue
        for needle, replacement in build(ext):
            if needle not in text:
                failures.append(f"{rel}.{ext}: needle not found ->\n    {needle[:100]}")
                continue
            text = text.replace(needle, replacement, 1)
        if text != original:
            path.write_text(text)
            changed.append(f"{rel}.{ext}")

for label, rows in (("patched", changed), ("skipped", skipped)):
    if rows:
        print(f"{label}:")
        for r in rows:
            print("  " + r)

if failures:
    print("\nFAILURES:")
    for f in failures:
        print("  " + f)
    sys.exit(1)
print("\nok")
