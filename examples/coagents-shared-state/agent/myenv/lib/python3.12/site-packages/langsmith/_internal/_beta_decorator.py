import functools
import warnings
from typing import Callable


class LangSmithBetaWarning(UserWarning):
    """This is a warning specific to the LangSmithBeta module."""


@functools.lru_cache(maxsize=100)
def _warn_once(message: str) -> None:
    warnings.warn(message, LangSmithBetaWarning, stacklevel=2)


def warn_beta(func: Callable) -> Callable:
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        _warn_once(f"Function {func.__name__} is in beta.")
        return func(*args, **kwargs)

    return wrapper
