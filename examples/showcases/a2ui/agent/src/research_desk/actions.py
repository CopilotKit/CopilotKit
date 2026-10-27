"""The reader's own Google apps, through Composio.

A reader connects Gmail, Calendar, Drive, Docs or Sheets from the app's
Connections page (Composio runs Google's sign-in and keeps the tokens). On
each run, `ConnectedAppsToolset` gives the model the tools of the apps that
reader has connected, and no others: a short, chosen list per app, not every
tool Composio has, so the model's choices stay clear.

Tools that send, create, change, share or delete pause the run for the
reader's yes (ADK tool confirmation). ag-ui-adk sends that pause to the app as
an AG-UI interrupt, and the app shows what the tool will do with a Confirm
button. Drafts are the exception: a draft only sits in the reader's mailbox.

Without COMPOSIO_API_KEY, or for a run with no signed-in reader, the toolset
is empty and the agent works as a research desk only.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from functools import lru_cache
from typing import Optional

from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools import FunctionTool
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.base_toolset import BaseToolset

from .identity import ANONYMOUS_USER

logger = logging.getLogger(__name__)

# Keep the app ids in sync with `src/lib/apps.ts` in the app.
APP_TOOLS: dict[str, list[str]] = {
    "gmail": [
        "GMAIL_FETCH_EMAILS",
        "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
        "GMAIL_CREATE_EMAIL_DRAFT",
        "GMAIL_SEND_EMAIL",
        "GMAIL_REPLY_TO_THREAD",
    ],
    "googlecalendar": [
        "GOOGLECALENDAR_EVENTS_LIST",
        "GOOGLECALENDAR_FIND_EVENT",
        "GOOGLECALENDAR_FIND_FREE_SLOTS",
        "GOOGLECALENDAR_CREATE_EVENT",
        "GOOGLECALENDAR_PATCH_EVENT",
        "GOOGLECALENDAR_DELETE_EVENT",
    ],
    "googledrive": [
        "GOOGLEDRIVE_FIND_FILE",
        "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
        "GOOGLEDRIVE_CREATE_FOLDER",
    ],
    "googledocs": [
        "GOOGLEDOCS_SEARCH_DOCUMENTS",
        "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT",
        "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
        "GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN",
    ],
    "googlesheets": [
        "GOOGLESHEETS_SEARCH_SPREADSHEETS",
        "GOOGLESHEETS_GET_SHEET_NAMES",
        "GOOGLESHEETS_VALUES_GET",
        "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
        "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
        "GOOGLESHEETS_VALUES_UPDATE",
    ],
}

# Everything that acts on the reader's behalf, except drafts.
CONFIRMED_TOOLS = frozenset(
    {
        "GMAIL_SEND_EMAIL",
        "GMAIL_REPLY_TO_THREAD",
        "GOOGLECALENDAR_CREATE_EVENT",
        "GOOGLECALENDAR_PATCH_EVENT",
        "GOOGLECALENDAR_DELETE_EVENT",
        "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
        "GOOGLEDRIVE_CREATE_FOLDER",
        "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
        "GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN",
        "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
        "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
        "GOOGLESHEETS_VALUES_UPDATE",
    }
)

# A connection made on the Connections page reaches the agent within this.
CACHE_SECONDS = 30


@lru_cache(maxsize=1)
def _composio():
    from composio import Composio
    from composio_google_adk import GoogleAdkProvider

    return Composio(provider=GoogleAdkProvider())


def _connected_apps(user_id: str) -> list[str]:
    accounts = _composio().connected_accounts.list(
        user_ids=[user_id],
        toolkit_slugs=list(APP_TOOLS),
        statuses=["ACTIVE"],
    )
    slugs = {account.toolkit.slug for account in accounts.items}
    return [app for app in APP_TOOLS if app in slugs]


def with_confirmation(tools: list[BaseTool]) -> list[BaseTool]:
    """The same tools, with the ones that act on the reader's behalf asking
    for their yes before they run."""
    confirmed: list[BaseTool] = []
    for tool in tools:
        if tool.name in CONFIRMED_TOOLS and isinstance(tool, FunctionTool):
            tool = type(tool)(tool.func, require_confirmation=True)
        confirmed.append(tool)
    return confirmed


def _load_tools(user_id: str) -> list[BaseTool]:
    from composio import SESSION_PRESET_DIRECT_TOOLS

    apps = _connected_apps(user_id)
    if not apps:
        return []
    session = _composio().create(
        user_id=user_id,
        toolkits=apps,
        tools={app: {"enable": APP_TOOLS[app]} for app in apps},
        session_preset=SESSION_PRESET_DIRECT_TOOLS,
    )
    return with_confirmation(list(session.tools()))


class ConnectedAppsToolset(BaseToolset):
    """The tools of the apps the run's reader has connected."""

    def __init__(self) -> None:
        super().__init__()
        self._cache: dict[str, tuple[float, list[BaseTool]]] = {}

    async def get_tools(
        self, readonly_context: Optional[ReadonlyContext] = None
    ) -> list[BaseTool]:
        if readonly_context is None or not os.getenv("COMPOSIO_API_KEY"):
            return []
        user_id = readonly_context.user_id
        if not user_id or user_id == ANONYMOUS_USER:
            return []
        cached = self._cache.get(user_id)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            return cached[1]
        try:
            # The Composio SDK is synchronous; keep it off the event loop.
            tools = await asyncio.to_thread(_load_tools, user_id)
        except Exception as exc:  # noqa: BLE001 - the desk still answers without them
            logger.warning("could not load connected app tools: %s", exc)
            return cached[1] if cached else []
        self._cache[user_id] = (time.monotonic(), tools)
        return tools
