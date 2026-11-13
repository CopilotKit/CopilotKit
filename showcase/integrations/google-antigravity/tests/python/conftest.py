"""Puts the package's ``src/`` and root on sys.path, as the image does.

``agent_server.py`` runs with ``/app`` (the package root, where ``tools`` and
``_shared`` live) and the agent modules side by side, so ``agents.*``,
and ``tools.*`` resolve the same way here.
"""

from __future__ import annotations

import os
import sys

_PKG_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SRC_DIR = os.path.join(_PKG_DIR, "src")
for path in (_PKG_DIR, _SRC_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)
