"""Generic utility functions."""

from __future__ import annotations

import contextlib
import contextvars
import copy
import enum
import functools
import logging
import os
import pathlib
import socket
import subprocess
import sys
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import (
    Any,
    Callable,
    Dict,
    Generator,
    Iterable,
    Iterator,
    List,
    Mapping,
    Optional,
    Sequence,
    Tuple,
    TypeVar,
    Union,
    cast,
)
from urllib import parse as urllib_parse

import httpx
import requests
from typing_extensions import ParamSpec
from urllib3.util import Retry

from langsmith import schemas as ls_schemas

_LOGGER = logging.getLogger(__name__)


class LangSmithError(Exception):
    """An error occurred while communicating with the LangSmith API."""


class LangSmithAPIError(LangSmithError):
    """Internal server error while communicating with LangSmith."""


class LangSmithUserError(LangSmithError):
    """User error caused an exception when communicating with LangSmith."""


class LangSmithRateLimitError(LangSmithError):
    """You have exceeded the rate limit for the LangSmith API."""


class LangSmithAuthError(LangSmithError):
    """Couldn't authenticate with the LangSmith API."""


class LangSmithNotFoundError(LangSmithError):
    """Couldn't find the requested resource."""


class LangSmithConflictError(LangSmithError):
    """The resource already exists."""


class LangSmithConnectionError(LangSmithError):
    """Couldn't connect to the LangSmith API."""


## Warning classes


class LangSmithWarning(UserWarning):
    """Base class for warnings."""


class LangSmithMissingAPIKeyWarning(LangSmithWarning):
    """Warning for missing API key."""


def tracing_is_enabled(ctx: Optional[dict] = None) -> bool:
    """Return True if tracing is enabled."""
    from langsmith.run_helpers import get_current_run_tree, get_tracing_context

    tc = ctx or get_tracing_context()
    # You can manually override the environment using context vars.
    # Check that first.
    # Doing this before checking the run tree lets us
    # disable a branch within a trace.
    if tc["enabled"] is not None:
        return tc["enabled"]
    # Next check if we're mid-trace
    if get_current_run_tree():
        return True
    # Finally, check the global environment
    var_result = get_env_var("TRACING_V2", default=get_env_var("TRACING", default=""))
    return var_result == "true"


def test_tracking_is_disabled() -> bool:
    """Return True if testing is enabled."""
    return get_env_var("TEST_TRACKING", default="") == "false"


def xor_args(*arg_groups: Tuple[str, ...]) -> Callable:
    """Validate specified keyword args are mutually exclusive."""

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            """Validate exactly one arg in each group is not None."""
            counts = [
                sum(1 for arg in arg_group if kwargs.get(arg) is not None)
                for arg_group in arg_groups
            ]
            invalid_groups = [i for i, count in enumerate(counts) if count != 1]
            if invalid_groups:
                invalid_group_names = [", ".join(arg_groups[i]) for i in invalid_groups]
                raise ValueError(
                    "Exactly one argument in each of the following"
                    " groups must be defined:"
                    f" {', '.join(invalid_group_names)}"
                )
            return func(*args, **kwargs)

        return wrapper

    return decorator


def raise_for_status_with_text(
    response: Union[requests.Response, httpx.Response],
) -> None:
    """Raise an error with the response text."""
    try:
        response.raise_for_status()
    except requests.HTTPError as e:
        raise requests.HTTPError(str(e), response.text) from e  # type: ignore[call-arg]


def get_enum_value(enu: Union[enum.Enum, str]) -> str:
    """Get the value of a string enum."""
    if isinstance(enu, enum.Enum):
        return enu.value
    return enu


@functools.lru_cache(maxsize=1)
def log_once(level: int, message: str) -> None:
    """Log a message at the specified level, but only once."""
    _LOGGER.log(level, message)


def _get_message_type(message: Mapping[str, Any]) -> str:
    if not message:
        raise ValueError("Message is empty.")
    if "lc" in message:
        if "id" not in message:
            raise ValueError(
                f"Unexpected format for serialized message: {message}"
                " Message does not have an id."
            )
        return message["id"][-1].replace("Message", "").lower()
    else:
        if "type" not in message:
            raise ValueError(
                f"Unexpected format for stored message: {message}"
                " Message does not have a type."
            )
        return message["type"]


def _get_message_fields(message: Mapping[str, Any]) -> Mapping[str, Any]:
    if not message:
        raise ValueError("Message is empty.")
    if "lc" in message:
        if "kwargs" not in message:
            raise ValueError(
                f"Unexpected format for serialized message: {message}"
                " Message does not have kwargs."
            )
        return message["kwargs"]
    else:
        if "data" not in message:
            raise ValueError(
                f"Unexpected format for stored message: {message}"
                " Message does not have data."
            )
        return message["data"]


def _convert_message(message: Mapping[str, Any]) -> Dict[str, Any]:
    """Extract message from a message object."""
    message_type = _get_message_type(message)
    message_data = _get_message_fields(message)
    return {"type": message_type, "data": message_data}


def get_messages_from_inputs(inputs: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Extract messages from the given inputs dictionary.

    Args:
        inputs (Mapping[str, Any]): The inputs dictionary.

    Returns:
        List[Dict[str, Any]]: A list of dictionaries representing
            the extracted messages.

    Raises:
        ValueError: If no message(s) are found in the inputs dictionary.
    """
    if "messages" in inputs:
        return [_convert_message(message) for message in inputs["messages"]]
    if "message" in inputs:
        return [_convert_message(inputs["message"])]
    raise ValueError(f"Could not find message(s) in run with inputs {inputs}.")


def get_message_generation_from_outputs(outputs: Mapping[str, Any]) -> Dict[str, Any]:
    """Retrieve the message generation from the given outputs.

    Args:
        outputs (Mapping[str, Any]): The outputs dictionary.

    Returns:
        Dict[str, Any]: The message generation.

    Raises:
        ValueError: If no generations are found or if multiple generations are present.
    """
    if "generations" not in outputs:
        raise ValueError(f"No generations found in in run with output: {outputs}.")
    generations = outputs["generations"]
    if len(generations) != 1:
        raise ValueError(
            "Chat examples expect exactly one generation."
            f" Found {len(generations)} generations: {generations}."
        )
    first_generation = generations[0]
    if "message" not in first_generation:
        raise ValueError(
            f"Unexpected format for generation: {first_generation}."
            " Generation does not have a message."
        )
    return _convert_message(first_generation["message"])


def get_prompt_from_inputs(inputs: Mapping[str, Any]) -> str:
    """Retrieve the prompt from the given inputs.

    Args:
        inputs (Mapping[str, Any]): The inputs dictionary.

    Returns:
        str: The prompt.

    Raises:
        ValueError: If the prompt is not found or if multiple prompts are present.
    """
    if "prompt" in inputs:
        return inputs["prompt"]
    if "prompts" in inputs:
        prompts = inputs["prompts"]
        if len(prompts) == 1:
            return prompts[0]
        raise ValueError(
            f"Multiple prompts in run with inputs {inputs}."
            " Please create example manually."
        )
    raise ValueError(f"Could not find prompt in run with inputs {inputs}.")


def get_llm_generation_from_outputs(outputs: Mapping[str, Any]) -> str:
    """Get the LLM generation from the outputs."""
    if "generations" not in outputs:
        raise ValueError(f"No generations found in in run with output: {outputs}.")
    generations = outputs["generations"]
    if len(generations) != 1:
        raise ValueError(f"Multiple generations in run: {generations}")
    first_generation = generations[0]
    if "text" not in first_generation:
        raise ValueError(f"No text in generation: {first_generation}")
    return first_generation["text"]


@functools.lru_cache(maxsize=1)
def get_docker_compose_command() -> List[str]:
    """Get the correct docker compose command for this system."""
    try:
        subprocess.check_call(
            ["docker", "compose", "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return ["docker", "compose"]
    except (subprocess.CalledProcessError, FileNotFoundError):
        try:
            subprocess.check_call(
                ["docker-compose", "--version"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return ["docker-compose"]
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise ValueError(
                "Neither 'docker compose' nor 'docker-compose'"
                " commands are available. Please install the Docker"
                " server following the instructions for your operating"
                " system at https://docs.docker.com/engine/install/"
            )


def convert_langchain_message(message: ls_schemas.BaseMessageLike) -> dict:
    """Convert a LangChain message to an example."""
    converted: Dict[str, Any] = {
        "type": message.type,
        "data": {"content": message.content},
    }
    # Check for presence of keys in additional_kwargs
    if message.additional_kwargs and len(message.additional_kwargs) > 0:
        converted["data"]["additional_kwargs"] = {**message.additional_kwargs}
    return converted


def is_base_message_like(obj: object) -> bool:
    """Check if the given object is similar to BaseMessage.

    Args:
        obj (object): The object to check.

    Returns:
        bool: True if the object is similar to BaseMessage, False otherwise.
    """
    return all(
        [
            isinstance(getattr(obj, "content", None), str),
            isinstance(getattr(obj, "additional_kwargs", None), dict),
            hasattr(obj, "type") and isinstance(getattr(obj, "type"), str),
        ]
    )


@functools.lru_cache(maxsize=100)
def get_env_var(
    name: str,
    default: Optional[str] = None,
    *,
    namespaces: Tuple = ("LANGSMITH", "LANGCHAIN"),
) -> Optional[str]:
    """Retrieve an environment variable from a list of namespaces.

    Args:
        name (str): The name of the environment variable.
        default (Optional[str], optional): The default value to return if the
            environment variable is not found. Defaults to None.
        namespaces (Tuple, optional): A tuple of namespaces to search for the
            environment variable. Defaults to ("LANGSMITH", "LANGCHAINs").

    Returns:
        Optional[str]: The value of the environment variable if found,
            otherwise the default value.
    """
    names = [f"{namespace}_{name}" for namespace in namespaces]
    for name in names:
        value = os.environ.get(name)
        if value is not None:
            return value
    return default


@functools.lru_cache(maxsize=1)
def get_tracer_project(return_default_value=True) -> Optional[str]:
    """Get the project name for a LangSmith tracer."""
    return os.environ.get(
        # Hosted LangServe projects get precedence over all other defaults.
        # This is to make sure that we always use the associated project
        # for a hosted langserve deployment even if the customer sets some
        # other project name in their environment.
        "HOSTED_LANGSERVE_PROJECT_NAME",
        get_env_var(
            "PROJECT",
            # This is the legacy name for a LANGCHAIN_PROJECT, so it
            # has lower precedence than LANGCHAIN_PROJECT
            default=get_env_var(
                "SESSION", default="default" if return_default_value else None
            ),
        ),
    )


class FilterPoolFullWarning(logging.Filter):
    """Filter urrllib3 warnings logged when the connection pool isn't reused."""

    def __init__(self, name: str = "", host: str = "") -> None:
        """Initialize the FilterPoolFullWarning filter.

        Args:
            name (str, optional): The name of the filter. Defaults to "".
            host (str, optional): The host to filter. Defaults to "".
        """
        super().__init__(name)
        self._host = host

    def filter(self, record) -> bool:
        """urllib3.connectionpool:Connection pool is full, discarding connection: ..."""
        msg = record.getMessage()
        if "Connection pool is full, discarding connection" not in msg:
            return True
        return self._host not in msg


class FilterLangSmithRetry(logging.Filter):
    """Filter for retries from this lib."""

    def filter(self, record) -> bool:
        """Filter retries from this library."""
        # We re-raise/log manually.
        msg = record.getMessage()
        return "LangSmithRetry" not in msg


class LangSmithRetry(Retry):
    """Wrapper to filter logs with this name."""


_FILTER_LOCK = threading.RLock()


@contextlib.contextmanager
def filter_logs(
    logger: logging.Logger, filters: Sequence[logging.Filter]
) -> Generator[None, None, None]:
    """Temporarily adds specified filters to a logger.

    Parameters:
    - logger: The logger to which the filters will be added.
    - filters: A sequence of logging.Filter objects to be temporarily added
        to the logger.
    """
    with _FILTER_LOCK:
        for filter in filters:
            logger.addFilter(filter)
    # Not actually perfectly thread-safe, but it's only log filters
    try:
        yield
    finally:
        with _FILTER_LOCK:
            for filter in filters:
                try:
                    logger.removeFilter(filter)
                except BaseException:
                    _LOGGER.warning("Failed to remove filter")


def get_cache_dir(cache: Optional[str]) -> Optional[str]:
    """Get the testing cache directory.

    Args:
        cache (Optional[str]): The cache path.

    Returns:
        Optional[str]: The cache path if provided, otherwise the value
        from the LANGSMITH_TEST_CACHE environment variable.
    """
    if cache is not None:
        return cache
    return get_env_var("TEST_CACHE", default=None)


@contextlib.contextmanager
def with_cache(
    path: Union[str, pathlib.Path], ignore_hosts: Optional[Sequence[str]] = None
) -> Generator[None, None, None]:
    """Use a cache for requests."""
    try:
        import vcr  # type: ignore[import-untyped]
    except ImportError:
        raise ImportError(
            "vcrpy is required to use caching. Install with:"
            'pip install -U "langsmith[vcr]"'
        )

    def _filter_request_headers(request: Any) -> Any:
        if ignore_hosts and any(request.url.startswith(host) for host in ignore_hosts):
            return None
        request.headers = {}
        return request

    cache_dir, cache_file = os.path.split(path)

    ls_vcr = vcr.VCR(
        serializer=(
            "yaml"
            if cache_file.endswith(".yaml") or cache_file.endswith(".yml")
            else "json"
        ),
        cassette_library_dir=cache_dir,
        # Replay previous requests, record new ones
        # TODO: Support other modes
        record_mode="new_episodes",
        match_on=["uri", "method", "path", "body"],
        filter_headers=["authorization", "Set-Cookie"],
        before_record_request=_filter_request_headers,
    )
    with ls_vcr.use_cassette(cache_file):
        yield


@contextlib.contextmanager
def with_optional_cache(
    path: Optional[Union[str, pathlib.Path]],
    ignore_hosts: Optional[Sequence[str]] = None,
) -> Generator[None, None, None]:
    """Use a cache for requests."""
    if path is not None:
        with with_cache(path, ignore_hosts):
            yield
    else:
        yield


def _format_exc() -> str:
    # Used internally to format exceptions without cluttering the traceback
    tb_lines = traceback.format_exception(*sys.exc_info())
    filtered_lines = [line for line in tb_lines if "langsmith/" not in line]
    return "".join(filtered_lines)


T = TypeVar("T")


def _middle_copy(
    val: T, memo: Dict[int, Any], max_depth: int = 4, _depth: int = 0
) -> T:
    cls = type(val)

    copier = getattr(cls, "__deepcopy__", None)
    if copier is not None:
        try:
            return copier(memo)
        except BaseException:
            pass
    if _depth >= max_depth:
        return val
    if isinstance(val, dict):
        return {  # type: ignore[return-value]
            _middle_copy(k, memo, max_depth, _depth + 1): _middle_copy(
                v, memo, max_depth, _depth + 1
            )
            for k, v in val.items()
        }
    if isinstance(val, list):
        return [_middle_copy(item, memo, max_depth, _depth + 1) for item in val]  # type: ignore[return-value]
    if isinstance(val, tuple):
        return tuple(_middle_copy(item, memo, max_depth, _depth + 1) for item in val)  # type: ignore[return-value]
    if isinstance(val, set):
        return {_middle_copy(item, memo, max_depth, _depth + 1) for item in val}  # type: ignore[return-value]

    return val


def deepish_copy(val: T) -> T:
    """Deep copy a value with a compromise for uncopyable objects.

    Args:
        val: The value to be deep copied.

    Returns:
        The deep copied value.
    """
    memo: Dict[int, Any] = {}
    try:
        return copy.deepcopy(val, memo)
    except BaseException as e:
        # Generators, locks, etc. cannot be copied
        # and raise a TypeError (mentioning pickling, since the dunder methods)
        # are re-used for copying. We'll try to do a compromise and copy
        # what we can
        _LOGGER.debug("Failed to deepcopy input: %s", repr(e))
        return _middle_copy(val, memo)


def is_version_greater_or_equal(current_version: str, target_version: str) -> bool:
    """Check if the current version is greater or equal to the target version."""
    from packaging import version

    current = version.parse(current_version)
    target = version.parse(target_version)
    return current >= target


def parse_prompt_identifier(identifier: str) -> Tuple[str, str, str]:
    """Parse a string in the format of owner/name:hash, name:hash, owner/name, or name.

    Args:
        identifier (str): The prompt identifier to parse.

    Returns:
        Tuple[str, str, str]: A tuple containing (owner, name, hash).

    Raises:
        ValueError: If the identifier doesn't match the expected formats.
    """
    if (
        not identifier
        or identifier.count("/") > 1
        or identifier.startswith("/")
        or identifier.endswith("/")
    ):
        raise ValueError(f"Invalid identifier format: {identifier}")

    parts = identifier.split(":", 1)
    owner_name = parts[0]
    commit = parts[1] if len(parts) > 1 else "latest"

    if "/" in owner_name:
        owner, name = owner_name.split("/", 1)
        if not owner or not name:
            raise ValueError(f"Invalid identifier format: {identifier}")
        return owner, name, commit
    else:
        if not owner_name:
            raise ValueError(f"Invalid identifier format: {identifier}")
        return "-", owner_name, commit


P = ParamSpec("P")


class ContextThreadPoolExecutor(ThreadPoolExecutor):
    """ThreadPoolExecutor that copies the context to the child thread."""

    def submit(  # type: ignore[override]
        self,
        func: Callable[P, T],
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> Future[T]:
        """Submit a function to the executor.

        Args:
            func (Callable[..., T]): The function to submit.
            *args (Any): The positional arguments to the function.
            **kwargs (Any): The keyword arguments to the function.

        Returns:
            Future[T]: The future for the function.
        """
        return super().submit(
            cast(
                Callable[..., T],
                functools.partial(
                    contextvars.copy_context().run, func, *args, **kwargs
                ),
            )
        )

    def map(
        self,
        fn: Callable[..., T],
        *iterables: Iterable[Any],
        timeout: Optional[float] = None,
        chunksize: int = 1,
    ) -> Iterator[T]:
        """Return an iterator equivalent to stdlib map.

        Each function will receive its own copy of the context from the parent thread.

        Args:
            fn: A callable that will take as many arguments as there are
                passed iterables.
            timeout: The maximum number of seconds to wait. If None, then there
                is no limit on the wait time.
            chunksize: The size of the chunks the iterable will be broken into
                before being passed to a child process. This argument is only
                used by ProcessPoolExecutor; it is ignored by
                ThreadPoolExecutor.

        Returns:
            An iterator equivalent to: map(func, *iterables) but the calls may
            be evaluated out-of-order.

        Raises:
            TimeoutError: If the entire result iterator could not be generated
                before the given timeout.
            Exception: If fn(*args) raises for any values.
        """
        contexts = [contextvars.copy_context() for _ in range(len(iterables[0]))]  # type: ignore[arg-type]

        def _wrapped_fn(*args: Any) -> T:
            return contexts.pop().run(fn, *args)

        return super().map(
            _wrapped_fn,
            *iterables,
            timeout=timeout,
            chunksize=chunksize,
        )


def get_api_url(api_url: Optional[str]) -> str:
    """Get the LangSmith API URL from the environment or the given value."""
    _api_url = api_url or cast(
        str,
        get_env_var(
            "ENDPOINT",
            default="https://api.smith.langchain.com",
        ),
    )
    if not _api_url.strip():
        raise LangSmithUserError("LangSmith API URL cannot be empty")
    return _api_url.strip().strip('"').strip("'").rstrip("/")


def get_api_key(api_key: Optional[str]) -> Optional[str]:
    """Get the API key from the environment or the given value."""
    api_key_ = api_key if api_key is not None else get_env_var("API_KEY", default=None)
    if api_key_ is None or not api_key_.strip():
        return None
    return api_key_.strip().strip('"').strip("'")


def _is_localhost(url: str) -> bool:
    """Check if the URL is localhost.

    Parameters
    ----------
    url : str
        The URL to check.

    Returns:
    -------
    bool
        True if the URL is localhost, False otherwise.
    """
    try:
        netloc = urllib_parse.urlsplit(url).netloc.split(":")[0]
        ip = socket.gethostbyname(netloc)
        return ip == "127.0.0.1" or ip.startswith("0.0.0.0") or ip.startswith("::")
    except socket.gaierror:
        return False


@functools.lru_cache(maxsize=2)
def get_host_url(web_url: Optional[str], api_url: str):
    """Get the host URL based on the web URL or API URL."""
    if web_url:
        return web_url
    parsed_url = urllib_parse.urlparse(api_url)
    if _is_localhost(api_url):
        link = "http://localhost"
    elif str(parsed_url.path).endswith("/api"):
        new_path = str(parsed_url.path).rsplit("/api", 1)[0]
        link = urllib_parse.urlunparse(parsed_url._replace(path=new_path))
    elif str(parsed_url.netloc).startswith("eu."):
        link = "https://eu.smith.langchain.com"
    elif str(parsed_url.netloc).startswith("dev."):
        link = "https://dev.smith.langchain.com"
    else:
        link = "https://smith.langchain.com"
    return link


def _get_function_name(fn: Callable, depth: int = 0) -> str:
    if depth > 2 or not callable(fn):
        return str(fn)

    if hasattr(fn, "__name__"):
        return fn.__name__

    if isinstance(fn, functools.partial):
        return _get_function_name(fn.func, depth + 1)

    if hasattr(fn, "__call__"):
        if hasattr(fn, "__class__") and hasattr(fn.__class__, "__name__"):
            return fn.__class__.__name__
        return _get_function_name(fn.__call__, depth + 1)

    return str(fn)
