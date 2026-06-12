"""Parity lever: the three reasoning_agent.py copies must stay identical.

crewai-crews, ag2, and langroid each ship a byte-for-byte copy of the
reasoning agent's executable logic (`_coerce_content`, `_to_chat_messages`,
`_run_reasoning_agent`, the endpoint plumbing). Only the comments, the module
docstring, and a single per-file literal — the FastAPI `title=` string — are
allowed to differ. crewai's behavioral tests (`test_reasoning_history.py`,
`test_reasoning_error_path.py`) therefore guard all three copies AS LONG AS the
copies do not drift apart. This test pins that invariant.

Mechanism (kept deliberately simple):
- Tokenize each file with the stdlib `tokenize` module.
- Drop COMMENT tokens (per-file comments are expected to differ) and the
  whitespace/encoding bookkeeping tokens (NL, NEWLINE, INDENT, DEDENT,
  ENCODING, ENDMARKER) that carry no semantic content.
- Drop docstrings: the module docstring and each function/class docstring is a
  bare STRING-expression statement at the start of a suite. We detect a true
  suite start structurally — module start, or the `NEWLINE INDENT` that opens a
  block after a `:` — and drop the first STRING there. Crucially we do NOT
  treat a STRING right after any COLON as a docstring, so dict values and
  keyword defaults (`{"role": "system"}`, `role="reasoning"`) are kept: those
  are behavioral literals that MUST match across the three copies.
- Compare the remaining (exact_type-name, string) token tuples across the
  three files, allowing ONLY the known per-file FastAPI title literal to
  differ.

A drop here (someone edits one copy without the others) makes the assertion
fail with a readable diff, so the fix — re-sync the copies — is obvious.
"""

from __future__ import annotations

import io
import os
import token
import tokenize

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))

# Paths relative to this test file (crewai-crews/tests/python/).
_FILES = {
    "crewai": os.path.join(_HERE, "../../src/agents/reasoning_agent.py"),
    "ag2": os.path.join(_HERE, "../../../ag2/src/agents/reasoning_agent.py"),
    "langroid": os.path.join(_HERE, "../../../langroid/src/agents/reasoning_agent.py"),
}

# The one literal that is allowed to differ per file: the FastAPI sub-app
# title. Normalized to a single sentinel so the comparison ignores it.
_TITLE_LITERALS = {
    '"AG2 Reasoning Agent"',
    '"CrewAI (Crews) Reasoning Agent"',
    '"Langroid Reasoning Agent"',
}
_TITLE_SENTINEL = "<FASTAPI_TITLE>"

# Tokens that carry no semantic content for the cross-file comparison but that
# we still observe to track suite structure for docstring detection.
_SKIP_TYPES = {
    token.NL,
    token.NEWLINE,
    token.INDENT,
    token.DEDENT,
    token.ENCODING,
    token.ENDMARKER,
    token.COMMENT,
}


def _semantic_tokens(path: str) -> list[tuple[str, str]]:
    """Return the comment/docstring-stripped (type-name, value) token stream."""
    with open(path, "rb") as fh:
        toks = list(tokenize.tokenize(fh.readline))

    result: list[tuple[str, str]] = []
    # A docstring is the first STRING-expression statement of a suite. A suite
    # starts at the module top and at the INDENT that opens a block. We arm
    # `at_suite_start` there and drop exactly the next STRING (the docstring),
    # then disarm — so dict values / kwargs after a `:` are NOT mistaken for
    # docstrings.
    at_suite_start = True
    for tok in toks:
        if tok.type == token.INDENT:
            at_suite_start = True
            continue
        if tok.type in _SKIP_TYPES:
            continue
        if tok.type == token.STRING and at_suite_start:
            # Leading string expression -> docstring; drop it and disarm.
            at_suite_start = False
            continue
        # Any other semantic token closes the suite-start window.
        at_suite_start = False
        value = tok.string
        if tok.type == token.STRING and value in _TITLE_LITERALS:
            value = _TITLE_SENTINEL
        result.append((token.tok_name[tok.exact_type], value))
    return result


def test_three_reasoning_agents_are_token_identical():
    streams = {name: _semantic_tokens(path) for name, path in _FILES.items()}
    reference_name = "crewai"
    reference = streams[reference_name]
    for name, stream in streams.items():
        if name == reference_name:
            continue
        assert stream == reference, (
            f"{name}/reasoning_agent.py drifted from "
            f"{reference_name}/reasoning_agent.py (comments/docstrings/title "
            "excluded). Re-sync the three copies — they must share identical "
            "executable logic so crewai's behavioral tests guard all three."
        )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
