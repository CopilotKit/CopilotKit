#!/usr/bin/env python3
"""Extract local rendered callout details to deduplicate visible marker findings."""

import concurrent.futures, html, json, re, urllib.error, urllib.request
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).parent
BASE = "http://127.0.0.1:3003"


def plain(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value))).strip()


def fetch(path):
    try:
        response = urllib.request.urlopen(BASE + path, timeout=45)
        body = response.read().decode("utf-8", "replace")
    except (urllib.error.URLError, urllib.error.HTTPError) as error:
        return path, None, type(error).__name__
    marker = re.search(r"Missing snippet</div>(.*?)</div>", body, re.I | re.S)
    if not marker:
        return path, None, None
    return path, plain(marker.group(1))[:600], None


def main():
    reconciliation = json.loads(
        (OUT / "global-rendered-marker-reconciliation.json").read_text()
    )
    paths = [alert["final_path"] for alert in reconciliation["alerts"]]
    details, errors = {}, {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for path, detail, error in pool.map(fetch, paths):
            if error:
                errors[path] = error
            else:
                details[path] = detail
    groups = defaultdict(list)
    for path, detail in details.items():
        groups[detail].append(path)
    output = {
        "schema_version": 1,
        "scope": "second-pass extraction from local rendered HTML only; no iframe or external requests",
        "summary": {
            "marker_paths": len(paths),
            "callout_details_extracted": sum(
                detail is not None for detail in details.values()
            ),
            "transport_errors": len(errors),
            "deduplicated_detail_groups": len(groups),
        },
        "detail_groups": [
            {"detail": detail, "paths": sorted(group_paths)}
            for detail, group_paths in sorted(
                groups.items(), key=lambda item: (item[0] or "", item[1])
            )
        ],
        "errors": errors,
    }
    (OUT / "global-rendered-marker-triage.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )
    lines = [
        "# Rendered marker detail triage",
        "",
        "Callout bodies were extracted from local shell-docs HTML only.",
        "",
        f"- Marker paths: {len(paths)}.",
        f"- Detail groups: {len(groups)}.",
        f"- Transport errors: {len(errors)}.",
        "",
    ]
    for detail, group_paths in sorted(
        groups.items(), key=lambda item: (item[0] or "", item[1])
    ):
        lines += [f"## {detail or 'No detail extracted'}", ""]
        lines += [f"- `{path}`" for path in sorted(group_paths)]
        lines.append("")
    (OUT / "global-rendered-marker-triage.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
