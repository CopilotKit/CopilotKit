import collections
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3104"
INVENTORY_PATH = (
    "/private/tmp/copilotkit-shell-docs-render-audit/inventory-snapshot.json"
)
ERROR_MARKERS = {
    "application_error": "Application error",
    "internal_server_error": "Internal Server Error",
    "failed_to_load": "Failed to load",
    "could_not_render": "Could not render",
    "missing_snippet": "Missing snippet",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def response_record(url):
    try:
        response = OPENER.open(
            urllib.request.Request(url, headers={"User-Agent": "feature-guide-audit"}),
            timeout=45,
        )
        status = response.status
    except urllib.error.HTTPError as error:
        response = error
        status = error.code
    body = response.read()
    text = body.decode("utf-8", errors="replace")
    title = re.search(r"<title>(.*?)</title>", text, re.S | re.I)
    return {
        "url": url,
        "status": status,
        "location": response.headers.get("location"),
        "content_type": response.headers.get("content-type"),
        "bytes": len(body),
        "title": re.sub(r"\s+", " ", title.group(1)).strip() if title else None,
        "has_next_not_found": "This page could not be found" in text,
        "iframe_count": text.lower().count("<iframe"),
        "error_markers": [
            name for name, marker in ERROR_MARKERS.items() if marker in text
        ],
    }


def probe(path):
    current = urllib.parse.urljoin(BASE, path)
    redirects = []
    for _ in range(10):
        record = response_record(current)
        status = record["status"]
        location = record["location"]
        if status in (301, 302, 303, 307, 308) and location:
            redirects.append(
                {
                    "status": status,
                    "from_path": urllib.parse.urlparse(current).path,
                    "location": location,
                }
            )
            current = urllib.parse.urljoin(current, location)
            continue
        return record, redirects
    return {
        "url": current,
        "status": None,
        "error_markers": ["redirect_limit"],
    }, redirects


with open(INVENTORY_PATH, "rb") as file:
    raw_inventory = file.read()
inventory = json.loads(raw_inventory)

catalog = {}
for cell in inventory["selected_matrix"]:
    if cell["frontend"] != "react" or not cell["projected_public_route"]:
        continue
    route = cell["projected_public_route"]
    route_data = catalog.setdefault(
        route,
        {
            "route": route,
            "family": "catalog-feature-guide",
            "guide_slugs": set(),
            "feature_ids": set(),
            "manifest_cell_statuses": set(),
            "availability_dispositions": set(),
            "audit_statuses": set(),
            "resolved_content": set(),
            "cell_ids": set(),
        },
    )
    route_data["guide_slugs"].add(cell["guide_binding"]["guide_slug"])
    route_data["feature_ids"].add(cell["feature_id"])
    route_data["manifest_cell_statuses"].add(cell["manifest_cell_status"])
    route_data["availability_dispositions"].add(cell["availability_disposition"])
    route_data["audit_statuses"].add(cell["audit_status"])
    if cell["resolved_content"]:
        route_data["resolved_content"].add(
            json.dumps(cell["resolved_content"], sort_keys=True)
        )
    route_data["cell_ids"].add(cell["cell_id"])

routes = []
for route, data in sorted(catalog.items()):
    routes.append(
        {
            key: sorted(value) if isinstance(value, set) else value
            for key, value in data.items()
        }
    )
for unit in inventory["product_guide_units"]:
    routes.append(
        {
            "route": unit["canonical_public_route"],
            "family": unit["family"],
            "guide_slugs": [unit["guide_slug"]],
            "feature_ids": unit["taxonomy_feature_ids"],
            "manifest_cell_statuses": [],
            "availability_dispositions": [],
            "audit_statuses": ["source_" + unit["root_source_status"]],
            "resolved_content": [unit["root_source_path"]]
            if unit["root_source_path"]
            else [],
            "cell_ids": [unit["id"]],
        }
    )

records = []
for route_data in routes:
    for representation, suffix in (("html", ""), ("mdx", ".mdx")):
        initial_path = route_data["route"] + suffix
        final, redirects = probe(initial_path)
        records.append(
            {
                **route_data,
                "representation": representation,
                "initial_path": initial_path,
                "final_path": urllib.parse.urlparse(final.get("url", "")).path
                if final.get("url")
                else None,
                "redirects": redirects,
                "final_status": final.get("status"),
                "content_type": final.get("content_type"),
                "bytes": final.get("bytes"),
                "title": final.get("title"),
                "has_next_not_found": final.get("has_next_not_found", False),
                "iframe_count": final.get("iframe_count", 0),
                "error_markers": final.get("error_markers", []),
            }
        )

by_key = collections.defaultdict(dict)
for record in records:
    by_key[(record["route"], record["family"])][record["representation"]] = record
for pair in by_key.values():
    html_status = pair["html"]["final_status"]
    mdx_status = pair["mdx"]["final_status"]
    if 200 <= html_status < 300 and 200 <= mdx_status < 300:
        availability = "both_representations_available"
    elif 200 <= html_status < 300 and mdx_status == 404:
        availability = "html_only_markdown_missing"
    elif html_status == 404 and mdx_status == 404:
        availability = "both_representations_not_found"
    else:
        availability = "mixed_or_nonstandard"
    for record in pair.values():
        record["representation_availability"] = availability

summary = {
    "route_count": len(routes),
    "record_count": len(records),
    "by_family": dict(collections.Counter(record["family"] for record in routes)),
    "final_statuses": dict(
        collections.Counter(str(record["final_status"]) for record in records)
    ),
    "representation_availability": dict(
        collections.Counter(
            record["representation_availability"]
            for record in records
            if record["representation"] == "html"
        )
    ),
    "redirected_records": sum(bool(record["redirects"]) for record in records),
    "records_with_error_markers": sum(
        bool(record["error_markers"]) for record in records
    ),
    "records_with_iframes": sum(record["iframe_count"] > 0 for record in records),
}

json.dump(
    {
        "schema_version": 1,
        "source_snapshot": inventory["metadata"]["baseline_source_revision"],
        "inventory_sha256": hashlib.sha256(raw_inventory).hexdigest(),
        "base_url": BASE,
        "summary": summary,
        "records": records,
    },
    sys.stdout,
    indent=2,
)
print()
