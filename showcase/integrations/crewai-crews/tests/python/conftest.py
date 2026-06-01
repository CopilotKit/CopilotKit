"""
pytest configuration.

`src/` import path is configured declaratively via `pythonpath = src` in
pytest.ini (pytest 7+). No sys.path mutation here — the previous
`sys.path.insert(0, ...)` was a permanent side effect that leaked past
test collection and would shadow identically-named packages if this pytest
process was reused (e.g. by an IDE's persistent test runner).
"""
