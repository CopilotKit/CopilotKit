"""conftest.py — put both ``showcase/integrations`` (for ``import _shared.*``)
and the langgraph-python package root (for ``import src.agents.*``) on
``sys.path`` so the CVDIAG schema-v1 suite imports exactly as the runtime does
(``/app`` on PYTHONPATH: ``/app/_shared`` and ``/app/src/agents`` both resolve).
"""

from __future__ import annotations

import sys
from pathlib import Path

# tests/conftest.py → langgraph-python (the /app root: contains src/ and _shared/)
_LGP_ROOT = Path(__file__).resolve().parents[1]
# langgraph-python → integrations (so the _shared symlink resolves the same way)
_INTEGRATIONS_DIR = _LGP_ROOT.parents[0]

for path in (str(_LGP_ROOT), str(_INTEGRATIONS_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)
