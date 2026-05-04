import logging

def configure_logging() -> None:
    """Enable INFO logs for ag_ui_agentspec and pyagentspec and attach a console handler.

    Uvicorn's default logging config doesn't automatically show 3rd‑party logger output.
    We install a root handler and set levels explicitly so logs appear in the terminal.
    """
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s"))
        root.addHandler(handler)
    root.setLevel(logging.INFO)
    for h in root.handlers:
        try:
            h.setLevel(logging.INFO)
        except Exception:
            pass

    # Turn on INFO for relevant namespaces and propagate to root
    for name in (
        "ag_ui_agentspec",
        "ag_ui_agentspec.endpoint",
        "ag_ui_agentspec.tracing",
        "pyagentspec",
        "wayflowcore",
    ):
        lg = logging.getLogger(name)
        lg.setLevel(logging.INFO)
        lg.propagate = True

    # Also make uvicorn loggers propagate to our root handler
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.setLevel(logging.INFO)
        lg.propagate = True