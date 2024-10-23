"""Various helper functions."""

from typing import Any, Callable, Dict, Generic, Optional, Protocol, Type, TypeVar

_T = TypeVar("_T")


class _TSelf(Protocol, Generic[_T]):
    _cache: Dict[str, _T]


class cached_property(Generic[_T]):
    """Use as a class method decorator.

    It operates almost exactly like
    the Python `@property` decorator, but it puts the result of the
    method it decorates into the instance dict after the first call,
    effectively replacing the function it decorates with an instance
    variable.  It is, in Python parlance, a data descriptor.
    """

    def __init__(self, wrapped: Callable[..., _T]) -> None:
        self.wrapped = wrapped
        self.__doc__ = wrapped.__doc__
        self.name = wrapped.__name__

    def __get__(self, inst: _TSelf[_T], owner: Optional[Type[Any]] = None) -> _T:
        try:
            try:
                return inst._cache[self.name]
            except KeyError:
                val = self.wrapped(inst)
                inst._cache[self.name] = val
                return val
        except AttributeError:
            if inst is None:
                return self
            raise

    def __set__(self, inst: _TSelf[_T], value: _T) -> None:
        raise AttributeError("cached property is read-only")
