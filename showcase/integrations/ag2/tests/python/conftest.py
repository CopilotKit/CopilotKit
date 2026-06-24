"""Pytest path configuration for ag2 showcase unit tests.

Ensures ``src/`` (so ``agents.*`` imports resolve) and the integration root
(so the ``_shared`` symlink → ``../_shared`` resolves as a package) are on
``sys.path``. Mirrors the strands integration's conftest path setup; ag2 tests
import the real agent modules (autogen is installed in CI / the image), so no
stub modules are installed here.
"""

import os
import sys

_HERE = os.path.dirname(__file__)
_PKG_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))

# src/ holds agent_server.py and agents/
sys.path.insert(0, os.path.join(_PKG_ROOT, "src"))
# project root: the ``_shared`` symlink → ../_shared lives here, plus the
# ``tools`` symlink the agent modules rely on.
sys.path.insert(0, _PKG_ROOT)
