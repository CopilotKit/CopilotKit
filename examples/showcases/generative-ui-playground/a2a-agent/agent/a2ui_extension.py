"""
A2UI Extension utilities for A2A protocol.

This module provides helper functions for creating and handling A2UI data parts
in A2A messages, enabling agent-driven UI rendering.
"""

import logging
from typing import Any, Optional

from a2a.server.agent_execution import RequestContext
from a2a.types import AgentExtension, Part, DataPart

logger = logging.getLogger(__name__)

# A2UI extension URI and constants
A2UI_EXTENSION_URI = "https://a2ui.org/a2a-extension/a2ui/v0.8"

MIME_TYPE_KEY = "mimeType"
A2UI_MIME_TYPE = "application/json+a2ui"

A2UI_CLIENT_CAPABILITIES_KEY = "a2uiClientCapabilities"
SUPPORTED_CATALOG_IDS_KEY = "supportedCatalogIds"
INLINE_CATALOGS_KEY = "inlineCatalogs"

STANDARD_CATALOG_ID = "https://raw.githubusercontent.com/google/A2UI/refs/heads/main/specification/0.8/json/standard_catalog_definition.json"


def create_a2ui_part(a2ui_data: dict[str, Any]) -> Part:
    """Creates an A2A Part containing A2UI data.

    Args:
        a2ui_data: The A2UI data dictionary.

    Returns:
        An A2A Part with a DataPart containing the A2UI data.
    """
    return Part(
        root=DataPart(
            data=a2ui_data,
            metadata={
                MIME_TYPE_KEY: A2UI_MIME_TYPE,
            },
        )
    )


def is_a2ui_part(part: Part) -> bool:
    """Checks if an A2A Part contains A2UI data."""
    return (
        isinstance(part.root, DataPart)
        and part.root.metadata
        and part.root.metadata.get(MIME_TYPE_KEY) == A2UI_MIME_TYPE
    )


def get_a2ui_datapart(part: Part) -> Optional[DataPart]:
    """Extracts the DataPart containing A2UI data from an A2A Part."""
    if is_a2ui_part(part):
        return part.root
    return None


def get_a2ui_agent_extension(
    accepts_inline_custom_catalog: bool = False,
) -> AgentExtension:
    """Creates the A2UI AgentExtension configuration."""
    params = {}
    if accepts_inline_custom_catalog:
        params["acceptsInlineCustomCatalog"] = True

    return AgentExtension(
        uri=A2UI_EXTENSION_URI,
        description="Provides agent driven UI using the A2UI JSON format.",
        params=params if params else None,
    )


def try_activate_a2ui_extension(context: RequestContext) -> bool:
    """Activates the A2UI extension if requested."""
    if A2UI_EXTENSION_URI in context.requested_extensions:
        context.add_activated_extension(A2UI_EXTENSION_URI)
        return True
    return False
