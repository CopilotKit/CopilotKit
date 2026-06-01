"""Pytest config for google-adk agent callback tests.

Adds the package's `src/` to sys.path so `from agents.main import ...` resolves
exactly the same way the runtime entry point does (see `src/agent_server.py`).
"""

from __future__ import annotations

import os
import sys

_PKG_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SRC_DIR = os.path.join(_PKG_DIR, "src")
if _PKG_DIR not in sys.path:
    sys.path.insert(0, _PKG_DIR)
if _SRC_DIR not in sys.path:
    sys.path.insert(0, _SRC_DIR)
