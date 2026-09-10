#!/usr/bin/env python3
"""Probe the local shell-docs surfaces for catalog-unmapped guide sources.

This intentionally keeps crawler reachability separate from feature-catalog
coverage and does not contact external demo iframes.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


BASE_URL = "http://127.0.0.1:3003"
DOCS_ROOT = Path("/private/tmp/copilotkit-shell-docs-render-audit/showcase/shell-docs")
OUTPUT = Path(__file__).with_name("reachable-outlier-route-probe.json")
GUIDES = ("generative-ui/hashbrown", "generative-ui/json-render")


def scoped_integrations() -> list[str]:
    registry = json.loads((DOCS_ROOT / "src/data/registry.json").read_text())
    return [
        item["slug"]
        for item in registry["integrations"]
        if item["slug"] != "built-in-agent" and item.get("docs_mode") != "hidden"
    ]


def fetch(path: str, representation: str) -> dict[str, object]:
    request_path = f"/llms-mdx/{path}" if representation == "mdx" else f"/{path}"
    url = f"{BASE_URL}{request_path}"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
            content_type = response.headers.get("content-type")
            title = None
            if representation == "html":
                match = re.search(r"<title>(.*?)</title>", body, flags=re.I | re.S)
                title = re.sub(r"\s+", " ", match.group(1)).strip() if match else None
            return {
                "path": f"/{path}",
                "representation": representation,
                "request_url": url,
                "status": response.status,
                "final_url": response.url,
                "content_type": content_type,
                "bytes": len(body.encode()),
                "title": title,
                "missing_snippet_marker": "Missing snippet" in body,
                "inline_demo_marker": "declarative-hashbrown" in body
                or "declarative-json-render" in body,
                "error": None,
            }
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return {
            "path": f"/{path}",
            "representation": representation,
            "request_url": url,
            "status": error.code,
            "final_url": error.geturl(),
            "content_type": error.headers.get("content-type"),
            "bytes": len(body.encode()),
            "title": None,
            "missing_snippet_marker": "Missing snippet" in body,
            "inline_demo_marker": "declarative-hashbrown" in body
            or "declarative-json-render" in body,
            "error": None,
        }
    except Exception as error:  # report, rather than hiding, local failures
        return {
            "path": f"/{path}",
            "representation": representation,
            "request_url": url,
            "status": None,
            "final_url": None,
            "content_type": None,
            "bytes": 0,
            "title": None,
            "missing_snippet_marker": False,
            "inline_demo_marker": False,
            "error": f"{type(error).__name__}: {error}",
        }


def main() -> None:
    integrations = scoped_integrations()
    paths = list(GUIDES) + [
        f"{integration}/{guide}" for integration in integrations for guide in GUIDES
    ]
    requests = [
        (path, representation) for path in paths for representation in ("html", "mdx")
    ]
    with ThreadPoolExecutor(max_workers=4) as executor:
        records = list(executor.map(lambda args: fetch(*args), requests))
    output = {
        "schema_version": 1,
        "method": "Local HTTP only against disposable shell-docs dev server; no external iframe requests.",
        "base_url": BASE_URL,
        "route_policy": {
            "bare_routes": list(GUIDES),
            "scoped_integrations": integrations,
            "scoped_route_count": len(integrations) * len(GUIDES),
            "total_html_mdx_representations": len(records),
        },
        "record_encoding": "object with route, representation, final response, title, marker checks, and error",
        "summary": {
            "requests": len(records),
            "http_200": sum(record["status"] == 200 for record in records),
            "non_200": sum(record["status"] != 200 for record in records),
            "transport_errors": sum(record["error"] is not None for record in records),
            "html_missing_snippet_markers": sum(
                record["representation"] == "html" and record["missing_snippet_marker"]
                for record in records
            ),
        },
        "records": records,
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
