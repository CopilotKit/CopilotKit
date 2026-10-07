#!/usr/bin/env python3
"""Summarise Built-in Agent D6 batch runs into JSON.

usage: bia-matrix-json.py <out.json> <run-name>=<tag>[@<head>] ...

For each run, reads bia-d6-<tag>-<batch>-20261006.log (feature-complete and
feature-retry events) and bia-d6-journal-<tag>-<batch>-20261006.json (AIMock
journal) for batches A1 A2 B1 B2 B3, and writes per-check results, request
and status counts, forwarded-header coverage and feature-retry counts.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BATCHES = ["A1", "A2", "B1", "B2", "B3"]
HEADERS = ("x-aimock-context", "x-aimock-strict", "x-test-id")
UNSHIPPED = {"threadid-frontend-tool-roundtrip"}


def batch(tag, b):
    log = os.path.join(HERE, f"bia-d6-{tag}-{b}-20261006.log")
    jr = os.path.join(HERE, f"bia-d6-journal-{tag}-{b}-20261006.json")
    checks, retries, features = [], 0, None
    for line in open(log, encoding="utf-8"):
        if line.startswith("$ ") and "--demos" in line:
            features = line.split("--demos", 1)[1].split()[0].split(",")
        if not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        msg = d.get("msg", "")
        if msg == "probe.e2e-full.feature-complete":
            c = {
                "check": d["featureType"],
                "pass": d["pass"],
                "seconds": round(d["durationMs"] / 1000, 1),
            }
            if not d["pass"]:
                c["error"] = d.get("errorDesc")
            checks.append(c)
        elif msg == "probe.e2e-full.feature-retry":
            retries += 1
    journal = json.load(open(jr, encoding="utf-8"))
    statuses = {}
    for e in journal:
        s = str((e.get("response") or {}).get("status"))
        statuses[s] = statuses.get(s, 0) + 1
    with_headers = sum(
        1 for e in journal if all(h in (e.get("headers") or {}) for h in HEADERS)
    )
    return {
        "features": features,
        "checks": checks,
        "requests": len(journal),
        "statuses": statuses,
        "requestsWithAllForwardedHeaders": with_headers,
        "featureRetries": retries,
    }


def main():
    out, runs = sys.argv[1], {}
    for spec in sys.argv[2:]:
        name, _, rest = spec.partition("=")
        tag, _, head = rest.partition("@")
        batches = {b: batch(tag, b) for b in BATCHES}
        allc = [c for b in batches.values() for c in b["checks"]]
        uniq = {c["check"]: c for c in allc}
        published = [c for k, c in uniq.items() if k not in UNSHIPPED]
        runs[name] = {
            "tag": tag,
            "head": head or None,
            "batches": batches,
            "raw": {"total": len(allc), "passed": sum(c["pass"] for c in allc)},
            "published": {
                "total": len(published),
                "passed": sum(c["pass"] for c in published),
            },
            "failed": sorted({c["check"] for c in allc if not c["pass"]}),
        }
    doc = {
        "integration": "built-in-agent",
        "date": "2026-10-06",
        "runner": "tasks/docs-feature-audit/run-local-d6.mts built-in-agent --demos <batch>",
        "unshippedChecks": sorted(UNSHIPPED),
        "runs": runs,
    }
    json.dump(doc, open(out, "w"), indent=1)
    for name, r in runs.items():
        print(
            name,
            "raw",
            r["raw"],
            "published",
            r["published"],
            "failed",
            r["failed"],
            "requests",
            sum(b["requests"] for b in r["batches"].values()),
        )


main()
