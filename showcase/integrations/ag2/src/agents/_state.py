"""Mid-run shared-state publishing for AG2 1.x tools.

``AGUIStream`` seeds the run's variables from the client's AG-UI state and
sends a STATE_SNAPSHOT when the run opens and again when it closes, if the
variables changed. A tool that wants the UI to see a change *while the run is
still going* (a progress card, a live plan) calls ``publish_state`` after
writing to ``ctx.variables``; it sends the same kind of snapshot through the
stream immediately.
"""

from ag2 import Context
from ag2.ag_ui import AGUIEvent
from ag_ui.core import StateSnapshotEvent
from pydantic_core import to_jsonable_python


async def publish_state(ctx: Context) -> None:
    """Send the run's current variables to the client as a STATE_SNAPSHOT."""
    snapshot = to_jsonable_python(dict(ctx.variables), fallback=str)
    await ctx.send(AGUIEvent(StateSnapshotEvent(snapshot=snapshot)))
