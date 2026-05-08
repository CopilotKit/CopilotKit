"""Convert a Notion CSV export into the kit's `leads.seed.json` shape.

Usage:
    uv run python -m scripts.csv_to_seed <path/to/export.csv>

Why this exists: the local-store path bundles a real-looking lead set so
hackathon participants get a working canvas on first `npm run dev` even
if they haven't wired Notion yet. Re-run this script whenever you want
to refresh the bundled fixture from a new Notion export — keeps the
seed honest with the real schema instead of drifting toward made-up
fields.

The output shape matches `Lead` in `src/lib/leads/types.ts` AND the row
shape produced by `notion_integration._row_from_props`:
    id, name, email, company, role, phone, source, technical_level,
    tools (list[str]), interested_in (list[str]), workshop, opt_in (bool),
    message, status, submitted_at (ISO 8601), url (None for local).

Notion's CSV column names are mapped per the v2a database
("AI Workshop Provider Community") — adjust `_COLUMN_MAP` if you change
the source schema.
"""

from __future__ import annotations

import csv
import json
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


# Maps Notion CSV column header → Lead field name. Whatever isn't listed
# is dropped silently.
_COLUMN_MAP = {
    "Full name": "name",
    "Company": "company",
    "Email": "email",
    "How technical are you?": "technical_level",
    "Interested in": "interested_in",
    "Message": "message",
    "Opt-in to updates": "opt_in",
    "Phone": "phone",
    "Role": "role",
    "Source": "source",
    "Status": "status",
    "Submitted at": "submitted_at",
    "What tools do you use?": "tools",
    "What workshop would you like to join next?": "workshop",
}


# Fields that Notion stores as multi-select (a comma-joined string in the
# CSV) and that the canvas expects as a list[str].
_MULTI_SELECT_FIELDS = {"tools", "interested_in"}


def _parse_multi_select(raw: str) -> list[str]:
    """Split Notion's comma-separated multi-select cell into a list."""
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def _parse_opt_in(raw: str) -> bool:
    """Notion's boolean property serializes to 'Yes' / 'No' in CSV."""
    return raw.strip().lower() == "yes"


def _parse_submitted_at(raw: str) -> str | None:
    """Convert Notion's CSV timestamp ('May 8, 2026 3:50 AM') to ISO 8601.

    Returns None when the cell is empty so downstream code can decide
    whether to fall back to a default (the canvas already tolerates a
    missing timestamp via `formatTimestamp` in LeadDetail.tsx).
    """
    raw = raw.strip()
    if not raw:
        return None
    try:
        dt = datetime.strptime(raw, "%B %d, %Y %I:%M %p")
        return dt.isoformat()
    except ValueError:
        # Surface unparseable values rather than silently dropping them
        # so a stale CSV format gets caught at conversion time.
        print(
            f"[csv_to_seed] WARN: could not parse 'Submitted at' value "
            f"{raw!r} — keeping as raw string",
            file=sys.stderr,
        )
        return raw


def convert(csv_path: Path) -> list[dict[str, Any]]:
    """Read a Notion CSV export and return a list of Lead dicts."""
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows: list[dict[str, Any]] = []
        for raw_row in reader:
            lead: dict[str, Any] = {
                # Stable per-row id derived from the email so re-running
                # the converter on the same CSV is idempotent.
                "id": _stable_id(raw_row.get("Email", "")),
                "url": None,
            }
            for csv_col, lead_field in _COLUMN_MAP.items():
                raw_value = (raw_row.get(csv_col) or "").strip()
                if lead_field in _MULTI_SELECT_FIELDS:
                    lead[lead_field] = _parse_multi_select(raw_value)
                elif lead_field == "opt_in":
                    lead[lead_field] = _parse_opt_in(raw_value)
                elif lead_field == "submitted_at":
                    lead[lead_field] = _parse_submitted_at(raw_value) or ""
                else:
                    lead[lead_field] = raw_value
            # `status` may be missing in older exports — default to the
            # canvas's empty bucket so the kanban renders cleanly.
            lead.setdefault("status", "Not started")
            rows.append(lead)
        return rows


def _stable_id(email: str) -> str:
    """Deterministic id from email so re-converts don't churn the file."""
    if not email:
        return str(uuid.uuid4())
    # uuid5 with a fixed namespace gives a stable mapping email → uuid.
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"leads.local/{email.lower()}"))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: uv run python -m scripts.csv_to_seed <csv_path>", file=sys.stderr)
        return 2
    csv_path = Path(argv[1]).expanduser()
    if not csv_path.exists():
        print(f"error: {csv_path} does not exist", file=sys.stderr)
        return 1
    rows = convert(csv_path)
    out_path = Path(__file__).resolve().parent.parent / "data" / "leads.seed.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
    print(f"[csv_to_seed] wrote {len(rows)} leads -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
