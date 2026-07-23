"""Launcher for the Hermes AG-UI adapter WITH showcase demo tools.

Imports ``showcase_tools`` first (which registers the server-side demo tools
``get_weather`` / ``search_flights`` / ``get_stock_price`` / ``roll_d20`` /
``get_revenue_chart`` into the Hermes tool registry under the ``hermes-showcase``
toolset), then starts the normal AG-UI adapter. With ``hermes-showcase`` in
``HERMES_AGUI_TOOLSETS`` (set in ``entrypoint.sh`` / the dev script), the
per-run agent enables + executes these tools SERVER-SIDE — 1:1 with
langgraph-python's backend-tool model — instead of relying on client-executed
``useFrontendTool`` handlers.

Both ``showcase_tools`` and ``agui_adapter`` resolve because ``/app`` is on
PYTHONPATH (Dockerfile) and ``.`` is on PYTHONPATH in the dev script; the
pip-installed hermes-agent modules resolve from the venv either way.
"""

import showcase_tools  # noqa: F401  (import registers the demo tools)
from agui_adapter.entry import main

if __name__ == "__main__":
    main()
