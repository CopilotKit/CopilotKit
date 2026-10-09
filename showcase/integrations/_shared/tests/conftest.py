"""conftest.py — put ``showcase/integrations`` on ``sys.path`` so the test suite
can ``import _shared.*`` exactly as the runtime does (``/app`` on PYTHONPATH,
``/app/_shared`` the package).
"""

from __future__ import annotations

import sys
from pathlib import Path

# showcase/integrations/_shared/tests/conftest.py → showcase/integrations
_INTEGRATIONS_DIR = Path(__file__).resolve().parents[2]
if str(_INTEGRATIONS_DIR) not in sys.path:
    sys.path.insert(0, str(_INTEGRATIONS_DIR))
