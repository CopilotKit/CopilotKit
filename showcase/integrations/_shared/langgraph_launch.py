"""Launch the pinned in-memory LangGraph server without the CLI config loss."""

import os
import pathlib
import sys
import tempfile
from importlib.metadata import version

from langgraph_cli.config import validate_config_file
from langgraph_api.cli import run_server


def main() -> None:
    # langgraph-cli 0.4.21 drops disable_persistence during validation, then
    # passes False to run_server and overrides the exported environment flag.
    # Keep this forwarding in step with the pinned CLI if either API changes.
    expected = {"langgraph-cli": "0.4.21", "langgraph-api": "0.7.101"}
    for package, pinned in expected.items():
        installed = version(package)
        if installed != pinned:
            raise RuntimeError(f"{package} is {installed}; launcher expects {pinned}")

    config = validate_config_file(pathlib.Path("langgraph.json"))
    if config.get("node_version"):
        raise RuntimeError("The in-memory Python server cannot load JS graphs")

    cwd = pathlib.Path.cwd()
    sys.path.append(str(cwd))
    for dependency in config.get("dependencies", []):
        dep_path = cwd / dependency
        if dep_path.is_dir():
            sys.path.append(str(dep_path))

    # The pinned runtime still loads old ops files and writes them at shutdown
    # with periodic persistence disabled. Its paths are relative to cwd, so run
    # from a temporary directory while keeping graph paths absolute. Existing
    # .langgraph_api files in the image remain untouched.
    graphs = {}
    for name, spec in config.get("graphs", {}).items():
        filename, symbol = spec.rsplit(":", 1)
        graphs[name] = f"{(cwd / filename).resolve()}:{symbol}"
    env = config.get("env")
    if isinstance(env, str):
        env = str((cwd / env).resolve())

    with tempfile.TemporaryDirectory(prefix="showcase-langgraph-inmem-") as temp:
        os.chdir(temp)
        try:
            run_server(
                host="0.0.0.0",
                port=8123,
                reload=False,
                graphs=graphs,
                open_browser=False,
                env=env,
                store=config.get("store"),
                auth=config.get("auth"),
                http=config.get("http"),
                ui=config.get("ui"),
                ui_config=config.get("ui_config"),
                webhooks=config.get("webhooks"),
                checkpointer=config.get("checkpointer"),
                disable_persistence=True,
            )
        finally:
            os.chdir(cwd)


if __name__ == "__main__":
    main()
