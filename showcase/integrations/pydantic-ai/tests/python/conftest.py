"""Pytest configuration for pydantic-ai showcase unit tests.

Ensures both the package root (so ``import _shared.cvdiag_bootstrap`` resolves
via the ``_shared`` symlink at the package root) and ``src/`` (so
``agents._cvdiag_backend`` imports) are on ``sys.path``. The CVDIAG boundary
tests exercise only the pure-Python emit surface (``agents._cvdiag_backend`` +
``_shared.cvdiag_bootstrap``), so no heavy runtime deps (pydantic-ai, the AG-UI
adapter) need stubbing here.
"""

import os
import sys

_HERE = os.path.dirname(__file__)
_PKG_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))

# src/ holds agent_server.py and agents/
sys.path.insert(0, os.path.join(_PKG_ROOT, "src"))
# package root carries the ``_shared`` symlink → ../_shared
sys.path.insert(0, _PKG_ROOT)
