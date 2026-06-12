"""Regression test for A2UI tool naming.

History: beautiful_chat.py and a2ui_dynamic.py used to hand-roll their own
dynamic-A2UI tool with an internal secondary-LLM helper named
`_design_a2ui_surface`. The rename away from `render_a2ui` was forced because
`@ag-ui/a2ui-middleware`'s default `a2uiToolNames` is `["render_a2ui"]` — any
tool by that name has its streaming args parsed into A2UI surface ops by the
middleware, bypassing the tool's own body.

Both agents now use the canonical path instead: the runtime injects
`generate_a2ui` (`a2ui.injectA2UITool: true`) and the `get_a2ui_tools` factory's
inner `render_a2ui` tool is intentionally intercepted by the middleware — that
interception IS the supported render mechanism, and catalog force-pinning /
malformed-root handling now live inside the factory (ag_ui_langgraph), not here.
So the old hand-rolled internal tool no longer exists to regression-test.

What still matters: the FIXED-schema demo (a2ui_fixed.py) owns an OUTER tool the
primary agent calls directly. If it were ever named into the middleware's
intercept list, the fixed-schema surface would render from raw streaming args
instead of the tool's validated output — the same class of bug. Guard that name.
"""

from __future__ import annotations

# `display_flight` is the OUTER tool the primary agent calls in the fixed-schema
# demo. Its name must stay out of the middleware's intercept list.
from src.agents.a2ui_fixed import display_flight as a2ui_fixed_display_flight


# A2UI middleware's default intercept list (mirrors `RENDER_A2UI_TOOL_NAME` in
# `@ag-ui/a2ui-middleware`). Any tool here gets its streaming args parsed as
# A2UI surface ops, bypassing the tool's own body.
A2UI_MIDDLEWARE_INTERCEPTED_NAMES = {"render_a2ui"}


def test_a2ui_fixed_display_flight_name_unchanged():
    """`display_flight` is the OUTER tool the primary agent calls. Renaming it
    to anything in the middleware's intercept list would break the fixed-schema
    demo by rendering from raw streaming args instead of the tool's output."""
    assert a2ui_fixed_display_flight.name not in A2UI_MIDDLEWARE_INTERCEPTED_NAMES, (
        f"a2ui_fixed.display_flight is named {a2ui_fixed_display_flight.name!r}, "
        f"which collides with the A2UI middleware's intercept list."
    )
