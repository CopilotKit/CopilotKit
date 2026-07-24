"""The single Python definition of Unicode Default Case Folding.

Every collision key in this SDK — ZIP member paths, artifact manifest paths,
cached file paths, and the portable contract validator's ``caseFold``
normalization — is derived here so that the folding rule cannot drift between
the SDK's own checks and the corpus-driven validator, or between Python,
TypeScript, and C#. The table is pinned to Unicode 17.0.0 rather than taken from
``str.casefold()`` because the interpreter's Unicode version varies by Python
release while the cross-language contract must not.
"""

from __future__ import annotations

import unicodedata

from .unicode_default_case_folding_data import UNICODE_DEFAULT_CASE_FOLD_MAPPINGS

__all__ = [
    "unicode_default_case_fold",
    "unicode_default_case_fold_normalized",
]


def unicode_default_case_fold(value: str) -> str:
    """Applies Unicode 17.0.0 full Default Case Folding (C and F mappings).

    Locale-specific Turkic (T) mappings are deliberately excluded.
    """
    return "".join(
        UNICODE_DEFAULT_CASE_FOLD_MAPPINGS.get(ord(character), character)
        for character in value
    )


def unicode_default_case_fold_normalized(value: str, form: str = "NFC") -> str:
    """Derives a normalization-then-folding collision key."""
    return unicode_default_case_fold(unicodedata.normalize(form, value))
