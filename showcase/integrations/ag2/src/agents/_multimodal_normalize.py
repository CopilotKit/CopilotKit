"""AG-UI legacy-content normalization for the AG2 multimodal backend.

Problem
-------
The ``multimodal`` showcase cell sends user messages whose ``content`` is a
list of AG-UI ``InputContent`` parts. ag2 1.0's ``AGUIStream`` maps the
modern shapes natively (``image`` / ``document`` / ``audio`` / ``video``
become typed agent inputs that the OpenAI adapter forwards as vision /
``input_file`` parts), so — unlike the pre-1.0 autogen adapter — no
``image_url`` rewriting is needed anymore.

One legacy wrinkle remains: the frontend at
``src/app/demos/multimodal/legacy-converter-shim.tsx`` APPENDS a legacy
``{"type": "binary", ...}`` MIRROR part alongside every modern
``image``/``document`` part (LangChain-based integrations only understand
the legacy shape). ag2 1.0 explicitly REJECTS the deprecated ``binary``
content type::

    ValueError("AG-UI 'binary' content type is deprecated; use
    ImageInputContent / ... instead.")

Fix
---
``NormalizingAGUIStream`` subclasses ``AGUIStream`` and overrides
``dispatch`` to DROP the legacy ``binary`` mirror parts from user
messages before delegating to the parent implementation. The modern
part carrying the same attachment is already present in the same
message, so dropping the mirror loses nothing.

The normalization runs AFTER ``RunAgentInput`` Pydantic parsing (which
still accepts ``binary`` as a valid AG-UI content type) and BEFORE the
parent ``dispatch`` maps content parts to agent inputs — the exact
seam where the deprecated-type ValueError would otherwise fire.

Failure path: any normalization error is logged at WARNING and the
original input is forwarded unchanged — ag2's own ``ValueError`` fires
verbatim, preserving the failure surface.

The normalizer is mounted ONLY on the ``multimodal_app`` sub-app
(``agents/multimodal_agent.py``), not on the global FastAPI server in
``agent_server.py`` — keeping the blast radius scoped to the one route
that actually sees attachment content parts.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from ag_ui.core import BinaryInputContent, TextInputContent

from ag2.ag_ui import AGUIStream, RunAgentInput

logger = logging.getLogger(__name__)


def strip_legacy_binary_parts(incoming: RunAgentInput) -> RunAgentInput:
    """Return ``incoming`` with legacy ``binary`` mirror parts removed.

    Only user messages with list-shaped content are touched. If a
    message consisted of NOTHING but binary parts (no modern mirror —
    defensive, should not happen with the current frontend shim), the
    content is replaced with a text placeholder so the turn still
    reaches the model instead of erroring out.

    Returns the original object untouched when there is nothing to
    strip, so the no-attachment fast path allocates nothing.
    """
    changed = False
    new_messages = []
    for msg in incoming.messages:
        content = getattr(msg, "content", None)
        if msg.role != "user" or not isinstance(content, list):
            new_messages.append(msg)
            continue
        kept = [p for p in content if not isinstance(p, BinaryInputContent)]
        if len(kept) == len(content):
            new_messages.append(msg)
            continue
        changed = True
        dropped = len(content) - len(kept)
        logger.info(
            "[ag2:multimodal-normalize] dropped %d legacy binary mirror part(s)",
            dropped,
        )
        if not kept:
            logger.warning(
                "[ag2:multimodal-normalize] message contained only legacy "
                "binary parts; replacing with text placeholder",
            )
            kept = [TextInputContent(type="text", text="[unreadable binary attachment]")]
        new_messages.append(msg.model_copy(update={"content": kept}))

    if not changed:
        return incoming
    return incoming.model_copy(update={"messages": new_messages})


class NormalizingAGUIStream(AGUIStream):
    """``AGUIStream`` subclass that strips legacy ``binary`` mirror parts.

    Overrides ``dispatch`` to rewrite the parsed ``RunAgentInput`` AFTER
    Pydantic validation and BEFORE the parent maps content parts to
    agent inputs. Modern ``image``/``document`` parts pass through to
    ag2 1.0's native multimodal mapping untouched.
    """

    async def dispatch(
        self,
        incoming: RunAgentInput,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        try:
            incoming = strip_legacy_binary_parts(incoming)
        except Exception as exc:  # noqa: BLE001 — log + fall back to original
            logger.warning(
                "[ag2:multimodal-normalize] pre-dispatch normalization failed "
                "(%s); forwarding original messages to ag2",
                exc,
                exc_info=True,
            )

        async for chunk in super().dispatch(incoming, **kwargs):
            yield chunk


__all__ = [
    "NormalizingAGUIStream",
    "strip_legacy_binary_parts",
]
