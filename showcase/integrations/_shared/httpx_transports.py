"""Discover the HTTP transports used by Python provider SDKs."""

import importlib
from collections.abc import Iterator
from types import ModuleType


def available_httpx_transports() -> Iterator[ModuleType]:
    """Include OpenAI 3's httpx2 without requiring it for older providers."""
    for name in ("httpx", "httpx2"):
        try:
            yield importlib.import_module(name)
        except ModuleNotFoundError as exc:
            # An absent optional transport is fine; a broken installed
            # transport (missing one of its dependencies) must stay visible.
            if exc.name != name:
                raise
