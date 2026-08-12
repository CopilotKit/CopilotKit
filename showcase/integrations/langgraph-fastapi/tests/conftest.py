"""conftest.py — put both ``showcase/integrations`` (for ``import _shared.*``)
and the langgraph-fastapi package root (for ``import src.agents.src.*``) on
``sys.path`` so the CVDIAG schema-v1 suite imports exactly as the runtime does
(``/app`` on PYTHONPATH: ``/app/_shared`` and ``/app/src/agents/src`` both
resolve).
"""

from __future__ import annotations

import sys
from pathlib import Path

# tests/conftest.py → langgraph-fastapi (the /app root: contains src/ and _shared/)
_LGFA_ROOT = Path(__file__).resolve().parents[1]
# langgraph-fastapi → integrations (so the _shared symlink resolves the same way)
_INTEGRATIONS_DIR = _LGFA_ROOT.parents[0]

for path in (str(_LGFA_ROOT), str(_INTEGRATIONS_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)
