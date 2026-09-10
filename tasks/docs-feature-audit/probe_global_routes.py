#!/usr/bin/env python3
"""Resumable, local-only rendered probe for the normalized global route matrix."""

import concurrent.futures, json, re, urllib.error, urllib.request
from collections import defaultdict, Counter
from pathlib import Path

OUT = Path(__file__).parent
BASE = "http://127.0.0.1:3003"
PROGRESS = OUT / "global-rendered-route-audit.json"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def get(item):
    route, rep, path = item
    try:
        r = OPENER.open(
            urllib.request.Request(
                BASE + path, headers={"User-Agent": "feature-guide-audit"}
            ),
            timeout=45,
        )
    except urllib.error.HTTPError as error:
        r = error
    except Exception as error:
        return route, rep, [None, None, None, None, type(error).__name__]
    body = r.read()
    text = body.decode("utf-8", "replace")
    title = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
    return (
        route,
        rep,
        [
            r.status,
            r.headers.get("location"),
            re.sub(r"\s+", " ", title.group(1)).strip() if title else None,
            len(body),
            None,
        ],
    )


def save(route_cells, results, total):
    table = []
    for route in sorted(route_cells):
        html, mdx = results.get((route, "html")), results.get((route, "mdx"))

        def ok(x):
            return x and x[0] and 200 <= x[0] < 300

        redirect = lambda x: x and x[0] in {301, 302, 303, 307, 308}
        state = (
            "pending"
            if not html or not mdx
            else "redirect-observed"
            if redirect(html) or redirect(mdx)
            else "both-available"
            if ok(html) and ok(mdx)
            else "html-only"
            if ok(html)
            else "unavailable-or-error"
        )
        table.append([route, state, html, mdx])
    done = sum(x is not None for row in table for x in row[2:])
    output = {
        "schema_version": 1,
        "base_url": BASE,
        "scope": "content-bearing catalog candidates plus product-guide units; local HTTP only; no iframe requests",
        "route_record_encoding": "[route, availability, html=[status,location,title,bytes,error]|null, mdx=same]",
        "cell_binding_encoding": "route -> cell IDs",
        "summary": {
            "routes": len(table),
            "representations_total": total,
            "representations_completed": done,
            "availability": dict(Counter(x[1] for x in table)),
        },
        "routes": table,
        "cell_bindings": {k: v for k, v in sorted(route_cells.items())},
    }
    PROGRESS.write_text(json.dumps(output, indent=2) + "\n")


def main():
    reach = json.loads((OUT / "global-route-reachability.json").read_text())
    outline = json.loads((OUT / "global-feature-outline.json").read_text())
    route_cells = defaultdict(list)
    for cell, state, route, _, _ in reach["rows"]:
        if state in {"framework-guide-content", "angular-native-or-redirected-guide"}:
            route_cells[route].append(cell)
    for unit in outline["product_guide_units"]:
        route_cells[unit["canonical_public_route"]].append(unit["id"])
    prior = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}
    results = {}
    for route, _, html, mdx in prior.get("routes", []):
        if html:
            results[(route, "html")] = html
        if mdx:
            results[(route, "mdx")] = mdx
    work = [
        (route, rep, route + suffix)
        for route in sorted(route_cells)
        for rep, suffix in (("html", ""), ("mdx", ".mdx"))
        if (route, rep) not in results
    ]
    total = len(route_cells) * 2
    save(route_cells, results, total)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for index, future in enumerate(
            concurrent.futures.as_completed([pool.submit(get, x) for x in work]), 1
        ):
            route, rep, record = future.result()
            results[(route, rep)] = record
            if index % 8 == 0 or index == len(work):
                save(route_cells, results, total)
    save(route_cells, results, total)
    final = json.loads(PROGRESS.read_text())
    (OUT / "global-rendered-route-audit.md").write_text(
        "# Global rendered-route audit\n\nLocal disposable shell-docs probe only; no external iframe request.\n\n- Routes: %s; responses: %s/%s.\n- Availability: %s.\n"
        % (
            final["summary"]["routes"],
            final["summary"]["representations_completed"],
            total,
            ", ".join(
                f"{k}={v}" for k, v in sorted(final["summary"]["availability"].items())
            ),
        )
    )


if __name__ == "__main__":
    main()
