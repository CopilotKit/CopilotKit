"""Pytest config for langroid adapter tests.

Adds the package's ``src/`` to ``sys.path`` so imports like
``from agents.agui_adapter import ...`` resolve identically to the
runtime path used by the FastAPI entry point in ``src/agent_server.py``
(which likewise imports ``agents.agui_adapter``). Keeping these import
paths aligned means a regression in the adapter surfaces in tests the
same way it would at runtime.
"""

from __future__ import annotations

import os
import sys

_PKG_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SRC_DIR = os.path.join(_PKG_DIR, "src")
# Include the integration root so the ``tools`` symlink
# (``langroid/tools`` → ``../../shared/python/tools``) is importable.
if _PKG_DIR not in sys.path:
    sys.path.insert(0, _PKG_DIR)
if _SRC_DIR not in sys.path:
    sys.path.insert(0, _SRC_DIR)
