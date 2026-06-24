"""_shared — single-source CVDIAG bootstrap shared across all 12 Python
integration backends.

The canonical copy lives at ``showcase/integrations/_shared/``; each Python
integration carries a ``_shared`` symlink → ``../_shared`` that the harness
build tooling (``stageSharedModules()`` / ``stage_shared()``) dereferences into
a real directory inside that integration's Docker build context, landing at
``/app/_shared/`` (``/app`` is on PYTHONPATH for all 12). Plan unit: L0-C.
"""
