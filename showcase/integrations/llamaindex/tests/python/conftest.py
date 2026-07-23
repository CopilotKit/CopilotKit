"""Pytest path configuration for llamaindex showcase unit tests.

Ensures ``src/`` (so ``agents.*`` imports resolve) and the integration root
(so the ``_shared`` symlink → ``../_shared`` resolves as a package) are on
``sys.path``. Mirrors the strands/ag2 integrations' conftest path setup; the
CVDIAG boundary tests import only ``agents._cvdiag_backend`` (which depends on
starlette + ``_shared.cvdiag_bootstrap`` only, NOT llama_index), so no stub
modules are installed here.
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
