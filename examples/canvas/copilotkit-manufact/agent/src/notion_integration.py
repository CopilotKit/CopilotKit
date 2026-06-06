"""Notion helpers for MCP-Use-backed agent tools (lead-form usecase).

Exposes:
- `get_database_schema`  — pull the Lead data-source's property schema so the
  agent can populate select / multi-select options on canvas entities.
- `fetch_leads`          — read all rows of the Leads database (paginated)
  and return a list of normalized lead dicts.
- `health_check`         — confirm the Notion MCP server is reachable and
  the source schema still has the properties the canvas expects.

All three are used by the LangChain backend tools in `notion_tools.py`.
The MCP server is `npx @notionhq/notion-mcp-server` (Notion's official),
auth via `NOTION_TOKEN`. See `notion_mcp.py` for the spawn pattern.

Schema this code maps against (the live database is "AI Workshop Provider
Community"; field names below match Notion exactly):
  Full name (title), Company (rich_text), Email (email), Role (rich_text),
  Phone (phone_number), Source (select), How technical are you? (select),
  Interested in (multi_select), What tools do you use? (multi_select),
  What workshop would you like to join next? (select),
  Opt-in to updates (checkbox), Message (rich_text),
  Submitted at (created_time).

If your Notion database has a different schema, normalize the property
accessors at the bottom of this file.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, TypedDict

from dotenv import load_dotenv

from .notion_mcp import (
    has_notion_token,
    mcp_create_page,
    mcp_fetch_data_source,
    mcp_fetch_database_schema,
    mcp_query_data_source,
    mcp_update_page,
)

# Load `agent/.env` here too so standalone callers (e.g.
# `uv run python -c "from src.notion_integration import health_check; print(health_check())"`)
# pick up NOTION_TOKEN / NOTION_LEADS_DATABASE_ID without having to call
# load_dotenv() themselves. Cheap when env is already loaded by main.py /
# notion_tools.py.
load_dotenv()


# Notion property names the `_read_*` accessors below expect to find. Used
# for the schema diff in `health_check` so a renamed column shows up as a
# missing property rather than a silent zero-value field.
EXPECTED_PROPS: List[str] = [
    "Full name",
    "Company",
    "Email",
    "Role",
    "Phone",
    "Source",
    "How technical are you?",
    "Interested in",
    "What tools do you use?",
    "What workshop would you like to join next?",
    "Status",
    "Opt-in to updates",
    "Message",
    "Submitted at",
]


# Module-level dedupe set so a renamed Notion column logs once per process.
_warned_props: set[str] = set()


def _warn_once(prop_name: str) -> None:
    """Print a one-time warning the first time `prop_name` is missing on a row."""
    if prop_name in _warned_props:
        return
    _warned_props.add(prop_name)
    print(
        f"[notion_integration] WARN: Notion property '{prop_name}' "
        "missing on a row — field will be empty in the canvas."
    )


class NotionHealth(TypedDict):
    user_id: str
    db_title: str
    row_count: int
    expected_props: List[str]
    actual_props: List[str]
    missing_props: List[str]
    error: Optional[str]


def _resolve_data_source_id(database_id: str) -> Optional[str]:
    """Look up the first data_source_id for a Notion database.

    Notion's 2025-09 API made databases a container for one or more
    "data sources"; the lead-form database has exactly one. Returns
    `None` if the database has no data sources or the call fails.
    """
    try:
        db = mcp_fetch_database_schema(database_id)
    except Exception as e:  # noqa: BLE001 - surface to caller as "no result"
        print(f"Error fetching Notion database for data_source resolution: {e}")
        return None
    sources = db.get("data_sources") or []
    if not sources:
        return None
    first = sources[0]
    if isinstance(first, dict):
        return first.get("id")
    return None


def get_database_schema(database_id: str) -> Optional[Dict[str, Any]]:
    """Return the property schema of a Notion database's first data source.

    Returns `None` if the MCP server isn't configured or the call fails —
    callers should treat that as "feature unavailable" rather than retry.
    """
    if not has_notion_token():
        return None
    try:
        ds_id = _resolve_data_source_id(database_id)
        if not ds_id:
            return None
        ds = mcp_fetch_data_source(ds_id)
        return ds.get("properties") or {}
    except Exception as e:  # noqa: BLE001 - surface to caller as "no result"
        print(f"Error getting Notion database schema: {e}")
        return None


def fetch_leads(database_id: str) -> Optional[List[Dict[str, Any]]]:
    """Fetch all rows from a Notion Leads database as normalized dicts.

    Pages through Notion's cursor-based query (`start_cursor` / `has_more`)
    until exhausted. Each row is shaped roughly as:
      { "id": <page_id>, "url": <page_url>,
        "name": str, "company": str, "email": str, "role": str, "phone": str,
        "source": str | "", "technical_level": str | "",
        "interested_in": list[str], "tools": list[str], "workshop": str | "",
        "opt_in": bool, "message": str, "submitted_at": str | "" }

    Returns `None` on configuration / API failure.
    """
    if not has_notion_token():
        return None

    rows: List[Dict[str, Any]] = []
    start_cursor: Optional[str] = None

    try:
        ds_id = _resolve_data_source_id(database_id)
        if not ds_id:
            print(f"No data_source found on database {database_id}")
            return None

        while True:
            result = mcp_query_data_source(
                data_source_id=ds_id,
                page_size=100,
                start_cursor=start_cursor,
            )
            for page in result.get("results") or []:
                props = page.get("properties") or {}
                rows.append(_row_from_props(page, props))

            if not result.get("has_more"):
                break
            start_cursor = result.get("next_cursor") or None
            if not start_cursor:
                break
        return rows
    except Exception as e:  # noqa: BLE001 - surface to caller as "no result"
        print(f"Error fetching Notion leads: {e}")
        return None


def _row_from_props(page: Dict[str, Any], props: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a Notion page + props dict into the Lead shape."""
    return {
        "id": page.get("id", ""),
        "url": page.get("url", ""),
        "name": _read_title(props, "Full name", fallback_key="Name"),
        "company": _read_rich_text(props, "Company"),
        "email": _read_email(props, "Email"),
        "role": _read_rich_text(props, "Role"),
        "phone": _read_phone(props, "Phone"),
        "source": _read_select(props, "Source"),
        "technical_level": _read_select(props, "How technical are you?"),
        "interested_in": _read_multi_select(props, "Interested in"),
        "tools": _read_multi_select(props, "What tools do you use?"),
        "workshop": _read_select(
            props, "What workshop would you like to join next?"
        ),
        "status": _read_status(props, "Status"),
        "opt_in": _read_checkbox(props, "Opt-in to updates"),
        "message": _read_rich_text(props, "Message"),
        "submitted_at": _read_created_time(props, "Submitted at"),
    }


def health_check(database_id: Optional[str] = None) -> NotionHealth:
    """Confirm we can reach the Notion DB and that the schema still matches.

    Best-effort: every failure mode collapses into a populated dict with
    `error` set, so callers can render a single integration-status line.
    """
    db_id = database_id or os.getenv("NOTION_LEADS_DATABASE_ID", "") or ""

    base: NotionHealth = {
        "user_id": "notion-mcp",  # legacy slot — was Composio user_id
        "db_title": "",
        "row_count": 0,
        "expected_props": list(EXPECTED_PROPS),
        "actual_props": [],
        "missing_props": list(EXPECTED_PROPS),
        "error": None,
    }

    if not db_id:
        base["error"] = (
            "NOTION_LEADS_DATABASE_ID is unset — cannot run health check."
        )
        return base

    if not has_notion_token():
        base["error"] = (
            "NOTION_TOKEN is unset — set it in agent/.env. Get a token at "
            "https://notion.so/my-integrations and share the leads database "
            "with that integration."
        )
        return base

    try:
        db = mcp_fetch_database_schema(db_id)
    except Exception as e:  # noqa: BLE001
        base["error"] = f"databases.retrieve raised: {e}"
        return base

    title_parts = db.get("title") or []
    base["db_title"] = (
        "".join(p.get("plain_text", "") for p in title_parts) or "Untitled"
    )

    sources = db.get("data_sources") or []
    if not sources:
        base["error"] = (
            "Notion database has no data_sources — has the database been "
            "shared with this integration token?"
        )
        return base
    ds_id = sources[0].get("id") if isinstance(sources[0], dict) else None
    if not ds_id:
        base["error"] = "Could not extract data_source id from databases.retrieve."
        return base

    try:
        ds = mcp_fetch_data_source(ds_id)
    except Exception as e:  # noqa: BLE001
        base["error"] = f"dataSources.retrieve raised: {e}"
        return base

    actual = list((ds.get("properties") or {}).keys())
    base["actual_props"] = actual
    base["missing_props"] = [p for p in EXPECTED_PROPS if p not in actual]

    # Notion doesn't return a total count, so fall back to fetching all rows
    # for an authoritative count. Cheap on the seeded 50-row test DB; if
    # this turns out to be slow on large DBs we'd swap to a bounded sample.
    rows = fetch_leads(db_id)
    base["row_count"] = len(rows) if rows is not None else 0
    return base


# --- Notion property accessors (defensive: every shape may be missing) ----


def _read_title(
    props: Dict[str, Any], key: str, fallback_key: Optional[str] = None
) -> str:
    prop = props.get(key)
    if prop is None and fallback_key is not None:
        prop = props.get(fallback_key)
    if not prop:
        _warn_once(key)
        return ""
    return "".join(part.get("plain_text", "") for part in prop.get("title", []) or [])


def _read_rich_text(props: Dict[str, Any], key: str) -> str:
    prop = props.get(key)
    if not prop:
        _warn_once(key)
        return ""
    return "".join(
        part.get("plain_text", "") for part in prop.get("rich_text", []) or []
    )


def _read_email(props: Dict[str, Any], key: str) -> str:
    prop = props.get(key)
    if not prop:
        _warn_once(key)
        return ""
    return prop.get("email") or ""


def _read_phone(props: Dict[str, Any], key: str) -> str:
    prop = props.get(key)
    if not prop:
        _warn_once(key)
        return ""
    return prop.get("phone_number") or ""


def _read_select(props: Dict[str, Any], key: str) -> str:
    prop = props.get(key)
    if not prop:
        _warn_once(key)
        return ""
    sel = prop.get("select") or {}
    return sel.get("name") or ""


def _read_status(props: Dict[str, Any], key: str) -> str:
    """Read a Notion `status`-type property. Mirrors `_read_select` but the
    payload key is `status` (not `select`); options have a fixed-by-Notion
    workflow ordering (e.g. Not started → In progress → Done)."""
    prop = props.get(key)
    if not prop:
        _warn_once(key)
        return ""
    s = prop.get("status") or {}
    return s.get("name") or ""


def _read_multi_select(props: Dict[str, Any], key: str) -> List[str]:
    prop = props.get(key)
    if not prop:
        _warn_once(key)
        return []
    return [opt.get("name", "") for opt in prop.get("multi_select", []) or []]


def _read_checkbox(props: Dict[str, Any], key: str) -> bool:
    prop = props.get(key)
    if not prop:
        _warn_once(key)
        return False
    return bool(prop.get("checkbox"))


def _read_created_time(props: Dict[str, Any], key: str) -> str:
    prop = props.get(key)
    if not prop:
        _warn_once(key)
        return ""
    return prop.get("created_time") or ""


# --- Notion property writers (inverse of the _read_* family above) --------
#
# Each writer takes the canonical Lead value and returns the Notion property
# fragment that goes under `properties[<column name>]` in a pages.update or
# pages.create call. They mirror the Notion REST shapes documented at
# https://developers.notion.com/reference/page-property-values.
#
# A few intentional rules:
#   - `_write_select` returns `None` when value is empty/falsy. Notion's API
#     treats `{"select": null}` as "clear this property", which is the right
#     default — sending `{"name": ""}` errors with 400 "Select option must
#     have a name".
#   - `_write_multi_select` always returns the full list (no None branch).
#     Pass `[]` to clear all options.
#   - `_write_email` / `_write_phone` accept `""` to clear, matching the
#     read-side default. Notion accepts `null` or `""` to clear.


def _write_title(value: str) -> Dict[str, Any]:
    """Build a Notion `title` property payload from a plain string."""
    return {"title": [{"type": "text", "text": {"content": value or ""}}]}


def _write_rich_text(value: str) -> Dict[str, Any]:
    """Build a `rich_text` property payload from a plain string."""
    return {"rich_text": [{"type": "text", "text": {"content": value or ""}}]}


def _write_email(value: str) -> Dict[str, Any]:
    """Build an `email` property payload. Pass '' to clear."""
    return {"email": value or None}


def _write_phone(value: str) -> Dict[str, Any]:
    """Build a `phone_number` property payload. Pass '' to clear."""
    return {"phone_number": value or None}


def _write_select(value: str) -> Dict[str, Any]:
    """Build a `select` property payload. Empty value clears the field."""
    if not value:
        return {"select": None}
    return {"select": {"name": value}}


def _write_status(value: str) -> Dict[str, Any]:
    """Build a Notion `status`-type property payload. Status options are
    workspace-defined (Not started / In progress / Done by default); Notion
    accepts `{name: <option-name>}` and resolves the id internally."""
    if not value:
        return {"status": None}
    return {"status": {"name": value}}


def _write_multi_select(values: List[str]) -> Dict[str, Any]:
    """Build a `multi_select` property payload. Empty list clears all options."""
    return {
        "multi_select": [
            {"name": v} for v in (values or []) if isinstance(v, str) and v
        ]
    }


def _write_checkbox(value: bool) -> Dict[str, Any]:
    """Build a `checkbox` property payload."""
    return {"checkbox": bool(value)}


# Lead-shape key -> (Notion property name, writer fn). Mirror of the order in
# `_row_from_props` above. Anything not in this map is silently dropped from
# patches (with a one-time warning) so the agent can pass through fields like
# `id`/`url`/`submitted_at` without us trying to write them.
_LEAD_FIELD_TO_NOTION = {
    "name": ("Full name", _write_title),
    "company": ("Company", _write_rich_text),
    "email": ("Email", _write_email),
    "role": ("Role", _write_rich_text),
    "phone": ("Phone", _write_phone),
    "source": ("Source", _write_select),
    "technical_level": ("How technical are you?", _write_select),
    "interested_in": ("Interested in", _write_multi_select),
    "tools": ("What tools do you use?", _write_multi_select),
    "workshop": ("What workshop would you like to join next?", _write_select),
    "status": ("Status", _write_status),
    "opt_in": ("Opt-in to updates", _write_checkbox),
    "message": ("Message", _write_rich_text),
}

# Read-only fields the agent might helpfully include in a patch — silently
# ignored on write rather than warned about.
_LEAD_READONLY_FIELDS = {"id", "url", "submitted_at"}


def _build_properties_payload(patch: Dict[str, Any]) -> Dict[str, Any]:
    """Translate a Lead-shaped partial dict into a Notion `properties` payload.

    Unknown keys log a one-time warning and are dropped — Notion will 400 on
    any property name that doesn't exist in the data source.
    """
    out: Dict[str, Any] = {}
    for key, value in (patch or {}).items():
        if key in _LEAD_READONLY_FIELDS:
            continue
        mapping = _LEAD_FIELD_TO_NOTION.get(key)
        if mapping is None:
            _warn_once(key)
            continue
        prop_name, writer = mapping
        out[prop_name] = writer(value)
    return out


def update_lead(
    database_id: str, page_id: str, patch: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Update a Notion page from a partial Lead patch and return the new lead.

    `database_id` is currently unused on the write path (Notion's update endpoint
    addresses the page directly), but kept in the signature so callers can pass
    the env-default db id symmetrically with `insert_lead`. Returns the merged
    Lead dict (re-read from the Notion echo) on success, or `None` on failure.
    """
    if not has_notion_token():
        return None
    if not page_id:
        print("update_lead: page_id is required")
        return None
    properties = _build_properties_payload(patch or {})
    if not properties:
        print(f"update_lead: nothing to write for {page_id} (patch was empty after filtering)")
        # Echo the patch as a successful no-op so the agent can still confirm.
        return {"id": page_id, **(patch or {})}
    try:
        page = mcp_update_page(page_id, properties)
    except Exception as e:  # noqa: BLE001 - surface to caller as None
        print(f"update_lead: mcp_update_page raised: {e}")
        return None
    props = (page or {}).get("properties") or {}
    if props:
        return _row_from_props(page, props)
    # Fallback: Notion didn't echo the row back — apply the patch locally.
    return {"id": page_id, **(patch or {})}


def insert_lead(
    database_id: str, lead: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Create a Notion page in `database_id` from a Lead dict.

    Returns the new Lead dict (with id/url filled in) on success, or `None` on
    failure. The lead's `id`/`url`/`submitted_at` fields are ignored — Notion
    assigns them.
    """
    if not has_notion_token():
        return None
    if not database_id:
        print("insert_lead: database_id is required")
        return None
    properties = _build_properties_payload(lead or {})
    try:
        page = mcp_create_page(database_id, properties)
    except Exception as e:  # noqa: BLE001 - surface to caller as None
        print(f"insert_lead: mcp_create_page raised: {e}")
        return None
    props = (page or {}).get("properties") or {}
    if props:
        return _row_from_props(page, props)
    # Fallback: Notion didn't echo properties — return the agent-supplied lead
    # with whatever ids the create call did surface.
    return {
        "id": (page or {}).get("id", ""),
        "url": (page or {}).get("url", ""),
        **(lead or {}),
    }
