"""Lead source adapter — Notion or local JSON, picked at boot.

Why this exists
---------------
Hackathon participants who haven't wired Notion yet still need a working
canvas to extend. Without a fallback, an unconfigured kit boots into an
empty pipeline that looks broken. The local store solves that: on first
read it materializes a seed JSON of 50 real-shape leads (sourced from
the v2a Notion export) into `agent/data/leads.local.json`, and from then
on every read/write/delete is a plain file mutation. Edits persist
between sessions, and a `Reset local data` UI button can wipe the file
to get back to the seed.

Resolution rule (boot-time)
---------------------------
- Both NOTION_TOKEN and NOTION_LEADS_DATABASE_ID set → `NotionStore`.
- Otherwise → `LocalJsonStore` (auto-bootstraps from `leads.seed.json`).

The agent's tool surface in `notion_tools.py` calls `get_store()` and
treats the result generically — it does NOT branch on Notion vs Local.
This keeps the agent prompt mostly Notion-flavored (the existing tool
names were too entangled to rename without churn) while the actual
data path is data-source agnostic.

To rotate data without restarting the agent, call `reset_store()` —
the next `get_store()` call re-resolves and picks up any env / file
changes. The Next.js `/api/leads/reset` route relies on this when it
deletes `leads.local.json`.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Protocol


# Module locations. `agent/data/` ships the bundled seed; `leads.local.json`
# is gitignored and gets created on first read.
_AGENT_ROOT = Path(__file__).resolve().parent.parent
_DATA_DIR = _AGENT_ROOT / "data"
SEED_PATH = _DATA_DIR / "leads.seed.json"
LOCAL_PATH = _DATA_DIR / "leads.local.json"


class LeadStore(Protocol):
    """Common contract for backends that the agent's tools call into."""

    def list_leads(self) -> list[dict[str, Any]]:
        """Return all leads. Empty list on failure (never None)."""

    def update_lead(
        self, lead_id: str, patch: dict[str, Any]
    ) -> Optional[dict[str, Any]]:
        """Apply `patch` to the lead with `lead_id`. Returns the merged row, or None on failure."""

    def insert_lead(self, lead: dict[str, Any]) -> Optional[dict[str, Any]]:
        """Create a new lead. Returns the new row (with id/url filled), or None on failure."""

    def database_title(self) -> str:
        """Human label for the source — surfaces in the canvas's sync banner."""

    def is_local(self) -> bool:
        """True for the local store, False for any remote source."""


# --------------------------------------------------------------------- Notion


class NotionStore:
    """Thin facade over `notion_integration` so tools don't import it directly."""

    def __init__(self, database_id: str) -> None:
        self.database_id = database_id

    def list_leads(self) -> list[dict[str, Any]]:
        from .notion_integration import fetch_leads

        rows = fetch_leads(self.database_id)
        return rows or []

    def update_lead(
        self, lead_id: str, patch: dict[str, Any]
    ) -> Optional[dict[str, Any]]:
        from .notion_integration import update_lead

        return update_lead(self.database_id, lead_id, patch)

    def insert_lead(self, lead: dict[str, Any]) -> Optional[dict[str, Any]]:
        from .notion_integration import insert_lead

        return insert_lead(self.database_id, lead)

    def database_title(self) -> str:
        # Tries the live API first (handles renames cleanly), falls back to
        # the well-known v2a name so the banner reads cleanly even if the
        # round-trip is skipped or fails.
        try:
            from .notion_integration import get_database_schema  # noqa: F401
            from .notion_mcp import mcp_fetch_database_schema

            db = mcp_fetch_database_schema(self.database_id)
            title_parts = (db.get("title") if isinstance(db, dict) else None) or []
            title = "".join(
                p.get("plain_text", "") for p in title_parts if isinstance(p, dict)
            )
            return title or "AI Workshop Provider Community"
        except Exception:  # noqa: BLE001 — banner string is best-effort
            return "AI Workshop Provider Community"

    def is_local(self) -> bool:
        return False


# ---------------------------------------------------------------------- local


# A single process-wide lock guards every read/write to leads.local.json
# so two concurrent tool calls (e.g. an in-flight `update_notion_lead`
# overlapping with the agent's next `fetch_notion_leads`) can't tear the
# file. The local-store path is a dev convenience, not a hot path, so a
# coarse lock is fine.
_FILE_LOCK = threading.Lock()


class LocalJsonStore:
    """File-backed store for the no-Notion-yet path.

    On first `list_leads()`, copies `leads.seed.json` to `leads.local.json`.
    From then on, the local file is the only source of truth. A reset is
    just `os.unlink(local_path)` — the next read repopulates from the seed.
    """

    def __init__(self, local_path: Path = LOCAL_PATH, seed_path: Path = SEED_PATH) -> None:
        self.local_path = local_path
        self.seed_path = seed_path

    # -- helpers ---------------------------------------------------------

    def _ensure_local(self) -> None:
        """Materialize the local file from the seed if it doesn't exist yet."""
        if self.local_path.exists():
            return
        if not self.seed_path.exists():
            # No seed shipped — create an empty list so list_leads() returns []
            # rather than raising. Useful in tests where the seed is stubbed.
            self.local_path.parent.mkdir(parents=True, exist_ok=True)
            self.local_path.write_text("[]\n", encoding="utf-8")
            return
        seed = self.seed_path.read_text(encoding="utf-8")
        self.local_path.parent.mkdir(parents=True, exist_ok=True)
        self.local_path.write_text(seed, encoding="utf-8")

    def _read_all(self) -> list[dict[str, Any]]:
        self._ensure_local()
        try:
            return json.loads(self.local_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(
                f"[lead_store] WARN: could not read {self.local_path}: {e}. "
                "Returning empty list — fix or delete the file to recover.",
                flush=True,
            )
            return []

    def _write_all(self, rows: list[dict[str, Any]]) -> None:
        # Atomic write: stage to a tmp sibling then rename, so a crash
        # mid-write can't leave the local file in a half-flushed state.
        tmp = self.local_path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(rows, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        os.replace(tmp, self.local_path)

    # -- LeadStore impl --------------------------------------------------

    def list_leads(self) -> list[dict[str, Any]]:
        with _FILE_LOCK:
            return self._read_all()

    def update_lead(
        self, lead_id: str, patch: dict[str, Any]
    ) -> Optional[dict[str, Any]]:
        if not lead_id:
            return None
        with _FILE_LOCK:
            rows = self._read_all()
            for i, row in enumerate(rows):
                if row.get("id") == lead_id:
                    merged = {**row, **(patch or {}), "id": lead_id}
                    rows[i] = merged
                    self._write_all(rows)
                    return merged
        # No row matched — agent is referencing a stale id. Surface as None
        # so the caller's error path (already wired) reports "update failed".
        return None

    def insert_lead(self, lead: dict[str, Any]) -> Optional[dict[str, Any]]:
        new_id = str(uuid.uuid4())
        new_row = {
            "id": new_id,
            "url": None,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            # Sensible defaults for the canvas fields; the agent's payload
            # overrides anything it explicitly sets.
            "name": "",
            "company": "",
            "email": "",
            "role": "",
            "phone": "",
            "source": "",
            "technical_level": "",
            "interested_in": [],
            "tools": [],
            "workshop": "Not sure yet",
            "status": "Not started",
            "opt_in": False,
            "message": "",
            **(lead or {}),
            # Force id/url last so the agent can't override them.
            "id": new_id,
            "url": None,
        }
        with _FILE_LOCK:
            rows = self._read_all()
            rows.append(new_row)
            self._write_all(rows)
        return new_row

    def database_title(self) -> str:
        return "Local: starter data"

    def is_local(self) -> bool:
        return True


# --------------------------------------------------------------- factory


_store_singleton: LeadStore | None = None
_resolve_lock = threading.Lock()


def get_store() -> LeadStore:
    """Return the resolved store, building it on first call.

    Tools call this on every invocation so a `reset_store()` between
    calls is picked up immediately. The lock ensures we don't double-
    construct under concurrent first-touch.
    """
    global _store_singleton
    if _store_singleton is not None:
        return _store_singleton
    with _resolve_lock:
        if _store_singleton is None:
            _store_singleton = _resolve()
    return _store_singleton


def reset_store() -> None:
    """Force the next `get_store()` call to re-resolve.

    Used by the reset path: the Next.js route deletes `leads.local.json`
    and would otherwise have no way to invalidate any cached state. We
    don't actually cache rows in `LocalJsonStore` (every read hits the
    file), but a future `NotionStore` cache could, so this hook stays.
    """
    global _store_singleton
    with _resolve_lock:
        _store_singleton = None


def _resolve() -> LeadStore:
    """Pick the store based on env. See module docstring for the rule."""
    notion_token = os.getenv("NOTION_TOKEN", "").strip()
    notion_db = os.getenv("NOTION_LEADS_DATABASE_ID", "").strip()
    if notion_token and notion_db:
        return NotionStore(notion_db)
    return LocalJsonStore()


# ----------------------------------------------------------------- diagnostics


def boot_status() -> str:
    """Format a one-line boot log for `agent/main.py` to print.

    Covers both store types so the operator can see which path is active
    without scrolling through a multi-line health block.
    """
    store = get_store()
    if store.is_local():
        local_path = LOCAL_PATH
        rows = store.list_leads()
        return (
            f'ok: source=local path="{local_path.relative_to(_AGENT_ROOT)}" '
            f"rows={len(rows)} (set NOTION_TOKEN + NOTION_LEADS_DATABASE_ID to "
            "switch to Notion)"
        )
    # Notion path — defer to the existing health check so any setup
    # gotchas (token, share, schema drift) show up in the boot log.
    from .notion_integration import health_check

    health = health_check()
    db_title = health.get("db_title") or "<unknown>"
    rows = health.get("row_count", 0)
    missing = health.get("missing_props") or []
    error = health.get("error")
    if error:
        return f'error: {error} (db="{db_title}", rows={rows}, missing={missing})'
    return (
        f'ok: source=notion db="{db_title}" rows={rows} missing={missing}'
    )
