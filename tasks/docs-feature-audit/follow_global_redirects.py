#!/usr/bin/env python3
"""Follow only local redirects from the rendered audit; never fetch external URLs."""

import concurrent.futures, json, re, urllib.error, urllib.parse, urllib.request
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


def request(url):
    try:
        r = OPENER.open(
            urllib.request.Request(url, headers={"User-Agent": "feature-guide-audit"}),
            timeout=45,
        )
    except urllib.error.HTTPError as error:
        r = error
    except Exception as error:
        return [None, None, None, [], type(error).__name__]
    body = r.read()
    text = body.decode("utf-8", "replace")
    title = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
    return [
        r.status,
        r.headers.get("location"),
        re.sub(r"\s+", " ", title.group(1)).strip() if title else None,
        [k for k, v in MARKERS.items() if v in text],
        None,
    ]


def follow(item):
    route, rep, first = item
    url = BASE + route + (".mdx" if rep == "mdx" else "")
    chain = []
    for _ in range(10):
        status, location, title, markers, error = request(url)
        parsed = urllib.parse.urlparse(url)
        if status in {301, 302, 303, 307, 308} and location:
            target = urllib.parse.urljoin(url, location)
            tp = urllib.parse.urlparse(target)
            chain.append([status, parsed.path, location])
            if tp.scheme not in {"", "http"} or (
                tp.netloc and tp.netloc not in {"127.0.0.1:3003", "localhost:3003"}
            ):
                return route, rep, ["external-not-fetched", chain, None, None, []]
            url = target
            continue
        return (
            route,
            rep,
            ["local-final", chain, status, title, markers, error, parsed.path],
        )
    return route, rep, ["hop-limit", chain, None, None, []]


def main():
    audit = json.loads((OUT / "global-rendered-route-audit.json").read_text())
    work = []
    for route, _, html, mdx in audit["routes"]:
        for rep, record in (("html", html), ("mdx", mdx)):
            if record[0] in {301, 302, 303, 307, 308}:
                work.append((route, rep, record))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(follow, work))
    results = {f"{route}|{rep}": value for route, rep, value in rows}
    summary = {
        "redirected_representations": len(rows),
        "outcomes": dict(Counter(v[0] for v in results.values())),
        "local_final_statuses": dict(
            Counter(str(v[2]) for v in results.values() if v[0] == "local-final")
        ),
        "records_with_visible_error_markers": sum(
            bool(v[4]) for v in results.values() if v[0] == "local-final"
        ),
    }
    output = {
        "schema_version": 1,
        "scope": "only local redirects observed by global-rendered-route-audit; external targets recorded but never fetched",
        "record_encoding": "route|representation -> [outcome, redirect_chain, final_status, final_title, visible_error_markers, error?, final_path?]",
        "summary": summary,
        "records": results,
    }
    (OUT / "global-rendered-redirect-audit.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )
    (OUT / "global-rendered-redirect-audit.md").write_text(
        "# Local redirect follow-up\n\nOnly local redirects were followed; external targets were not fetched.\n\n- Redirected representations: %s.\n- Outcomes: %s.\n- Final local statuses: %s.\n- Final responses with visible error markers: %s.\n"
        % (
            len(rows),
            ", ".join(f"{k}={v}" for k, v in sorted(summary["outcomes"].items())),
            ", ".join(
                f"{k}={v}" for k, v in sorted(summary["local_final_statuses"].items())
            ),
            summary["records_with_visible_error_markers"],
        )
    )


if __name__ == "__main__":
    main()
