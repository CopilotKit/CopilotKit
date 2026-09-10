#!/usr/bin/env python3
"""Scan final local rendered HTML pages for visible documentation render errors."""

import concurrent.futures, json, re, urllib.error, urllib.request
from collections import Counter
from pathlib import Path

OUT = Path(__file__).parent
BASE = "http://127.0.0.1:3003"
MARKERS = {
    "application_error": "Application error",
    "internal_server_error": "Internal Server Error",
    "could_not_render": "Could not render",
    "missing_snippet": "Missing snippet",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def fetch(path):
    try:
        response = OPENER.open(
            urllib.request.Request(
                BASE + path, headers={"User-Agent": "feature-guide-audit"}
            ),
            timeout=45,
        )
    except urllib.error.HTTPError as error:
        response = error
    except Exception as error:
        return path, [None, None, [], type(error).__name__]
    text = response.read().decode("utf-8", "replace")
    title = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
    return path, [
        response.status,
        re.sub(r"\s+", " ", title.group(1)).strip() if title else None,
        [key for key, marker in MARKERS.items() if marker in text],
        None,
    ]


def write(records):
    summary = {
        "final_html_paths_scanned": len(records),
        "statuses": dict(Counter(str(record[0]) for record in records.values())),
        "paths_with_visible_error_markers": sum(
            bool(record[2]) for record in records.values()
        ),
        "marker_counts": dict(
            Counter(marker for record in records.values() for marker in record[2])
        ),
        "transport_errors": sum(record[3] is not None for record in records.values()),
    }
    output = {
        "schema_version": 1,
        "scope": "final local HTML paths from the global route audit; local server only; no iframe targets fetched",
        "record_encoding": "final_path -> [status, title, visible_error_markers, error]",
        "summary": summary,
        "records": dict(sorted(records.items())),
    }
    (OUT / "global-rendered-marker-audit.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )
    (OUT / "global-rendered-marker-audit.md").write_text(
        "# Rendered HTML marker audit\n\n"
        "Final local HTML routes were fetched without following or requesting external URLs.\n\n"
        f"- Final HTML paths scanned: {summary['final_html_paths_scanned']}.\n"
        f"- Statuses: {', '.join(f'{k}={v}' for k, v in sorted(summary['statuses'].items()))}.\n"
        f"- Paths with visible error markers: {summary['paths_with_visible_error_markers']}.\n"
        f"- Marker counts: {', '.join(f'{k}={v}' for k, v in sorted(summary['marker_counts'].items())) or 'none'}.\n"
        f"- Transport errors: {summary['transport_errors']}.\n"
    )


def main():
    audit = json.loads((OUT / "global-rendered-route-audit.json").read_text())
    redirects = json.loads((OUT / "global-rendered-redirect-audit.json").read_text())
    paths = {route for route, _, html, _ in audit["routes"] if html[0] == 200}
    paths.update(
        record[6]
        for key, record in redirects["records"].items()
        if key.endswith("|html")
        and record[0] == "local-final"
        and record[2] == 200
        and record[6]
    )
    existing = {}
    saved = OUT / "global-rendered-marker-audit.json"
    if saved.exists():
        prior = json.loads(saved.read_text())
        existing = {
            path: record for path, record in prior["records"].items() if path in paths
        }
    pending = sorted(paths - existing.keys())
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for index, (path, record) in enumerate(pool.map(fetch, pending), 1):
            existing[path] = record
            if index % 25 == 0:
                write(existing)
    write(existing)


if __name__ == "__main__":
    main()
