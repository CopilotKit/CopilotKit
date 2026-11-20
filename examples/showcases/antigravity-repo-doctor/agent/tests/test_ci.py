from repo_doctor.ci import latest_runs


def test_keeps_the_newest_run_of_each_workflow() -> None:
    runs = [
        {"id": 3, "name": "Test & lint beets Master", "conclusion": "failure", "event": "schedule"},
        {"id": 2, "name": "CodeQL", "conclusion": "success", "event": "push"},
        {"id": 1, "name": "Test & lint beets Master", "conclusion": "success", "event": "schedule"},
    ]

    latest = latest_runs(runs)

    assert [(r["workflow"], r["id"], r["conclusion"]) for r in latest] == [
        ("Test & lint beets Master", 3, "failure"),
        ("CodeQL", 2, "success"),
    ]


def test_falls_back_to_the_workflow_file_name() -> None:
    [run] = latest_runs([{"id": 1, "path": ".github/workflows/ci.yml", "conclusion": "success"}])

    assert run["workflow"] == ".github/workflows/ci.yml"


def test_skips_dependabot_update_jobs() -> None:
    runs = [
        {
            "id": 2,
            "name": "uv in / for ruff - Update #1",
            "event": "dynamic",
            "conclusion": "success",
        },
        {"id": 1, "name": "CI", "event": "push", "conclusion": "success"},
    ]

    assert [r["workflow"] for r in latest_runs(runs)] == ["CI"]


def test_skips_pull_request_runs_that_share_the_branch_name() -> None:
    runs = [
        {"id": 3, "name": "CI", "event": "pull_request", "conclusion": "failure"},
        {"id": 2, "name": "CI", "event": "push", "conclusion": "success"},
    ]

    assert [(r["id"], r["conclusion"]) for r in latest_runs(runs)] == [(2, "success")]
