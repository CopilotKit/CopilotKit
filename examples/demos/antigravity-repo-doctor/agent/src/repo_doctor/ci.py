"""Recent GitHub Actions results for a public repository.

Uses the public REST API, with the optional read-only GITHUB_TOKEN when one is
configured (5,000 requests an hour instead of 60 per IP). The token is only
sent to api.github.com and never reaches the harness or a shell. Two calls at
most: the latest runs, then the jobs of the newest failing run.
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from typing import Any

_API = "https://api.github.com"
_TIMEOUT_SECONDS = 15
_RUNS_PER_PAGE = 30
_NOT_BRANCH_CI = frozenset({"dynamic", "pull_request", "pull_request_target"})


class GitHubAPIError(Exception):
    pass


def _get(path: str, token: str | None) -> Any:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "repo-doctor"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"{_API}{path}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        hint = " (rate limited, try again later)" if exc.code in (403, 429) else ""
        raise GitHubAPIError(f"GitHub API returned {exc.code}{hint}.") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise GitHubAPIError(f"GitHub API unreachable: {exc}") from exc


def latest_runs(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The newest run of each workflow, newest first."""
    seen: set[str] = set()
    latest: list[dict[str, Any]] = []
    for run in runs:
        # Dependabot's update jobs are not CI the repository defines, and pull
        # request runs belong to the PR's code (a fork's branch can share the
        # default branch's name).
        if run.get("event") in _NOT_BRANCH_CI:
            continue
        name = str(run.get("name") or run.get("path") or "workflow")
        if name in seen:
            continue
        seen.add(name)
        latest.append(
            {
                "workflow": name,
                "id": run.get("id"),
                "event": run.get("event"),
                "status": run.get("status"),
                "conclusion": run.get("conclusion"),
                "startedAt": run.get("run_started_at") or run.get("created_at"),
                "url": run.get("html_url"),
                "file": run.get("path"),
            }
        )
    return latest


def _summary(slug: str, branch: str, token: str | None) -> dict[str, Any]:
    data = _get(f"/repos/{slug}/actions/runs?branch={branch}&per_page={_RUNS_PER_PAGE}", token)
    runs = latest_runs(list(data.get("workflow_runs", [])))
    failing = [r for r in runs if r["conclusion"] in ("failure", "timed_out")]
    result: dict[str, Any] = {"branch": branch, "workflows": runs, "failing": len(failing)}
    if failing and failing[0]["id"] is not None:
        jobs = _get(f"/repos/{slug}/actions/runs/{failing[0]['id']}/jobs?per_page=50", token)
        result["failedJobs"] = [
            {
                "name": job.get("name"),
                "url": job.get("html_url"),
                # Job logs need a token; the failed step's name is public.
                "failedSteps": [
                    step.get("name")
                    for step in job.get("steps") or []
                    if step.get("conclusion") == "failure"
                ],
            }
            for job in jobs.get("jobs", [])
            if job.get("conclusion") == "failure"
        ]
    return result


async def ci_summary(slug: str, branch: str, token: str | None = None) -> dict[str, Any]:
    return await asyncio.to_thread(_summary, slug, branch, token)
