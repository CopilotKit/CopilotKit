import os
import sys
from typing import TYPE_CHECKING

__all__ = ("cached_property",)


NO_EXTENSIONS = bool(os.environ.get("YARL_NO_EXTENSIONS"))  # type: bool
if sys.implementation.name != "cpython":
    NO_EXTENSIONS = True


# isort: off
if TYPE_CHECKING:
    from ._helpers_py import cached_property as cached_property_py

    cached_property = cached_property_py
elif not NO_EXTENSIONS:  # pragma: no branch
    try:
        from ._helpers_c import cached_property as cached_property_c  # type: ignore[attr-defined, unused-ignore] # noqa: E501

        cached_property = cached_property_c
    except ImportError:  # pragma: no cover
        from ._helpers_py import cached_property as cached_property_py

        cached_property = cached_property_py  # type: ignore[assignment, misc]
else:
    from ._helpers_py import cached_property as cached_property_py

    cached_property = cached_property_py  # type: ignore[assignment, misc]
# isort: on
