"""_shared.harness — single-source test-harness plumbing for the Python
integration backends.

These modules are showcase *harness* concerns, not agent code: they forward the
inbound CopilotKit ``x-*`` headers (so aimock can match the right fixture) and
emit the CVDIAG backend boundaries. They teach nothing about the agent
framework an integration demonstrates, so they do not belong under a backend's
``agents/`` package.

Reached the same way as the rest of ``_shared``: each Python integration
carries a ``_shared`` symlink → ``../_shared`` which the harness build tooling
(``stageSharedModules()`` / ``stage_shared()``) dereferences into a real
directory inside that integration's Docker build context, landing at
``/app/_shared/`` (``/app`` is on PYTHONPATH). Import as
``_shared.harness.header_forwarding`` / ``_shared.harness.cvdiag_backend``.

Per ``showcase/AGENTS.md``: edit THIS copy, never a per-integration one.
"""
