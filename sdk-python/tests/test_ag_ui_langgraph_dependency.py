from pathlib import Path


SDK_PYTHON = Path(__file__).parents[1]


def test_ag_ui_langgraph_includes_missing_message_id_guard_release():
    pyproject = (SDK_PYTHON / "pyproject.toml").read_text()
    lockfile = (SDK_PYTHON / "poetry.lock").read_text()

    assert 'ag-ui-langgraph = { version = ">=0.0.44"' in pyproject
    package_start = lockfile.index('name = "ag-ui-langgraph"')
    package_end = lockfile.index("[[package]]", package_start + 1)
    assert 'version = "0.0.44"' in lockfile[package_start:package_end]
