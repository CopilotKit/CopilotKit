import math
import re
import sys
import warnings
from collections.abc import Mapping, Sequence
from contextlib import suppress
from functools import _CacheInfo, lru_cache
from ipaddress import ip_address
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Iterable,
    Iterator,
    List,
    SupportsInt,
    Tuple,
    TypedDict,
    TypeVar,
    Union,
    overload,
)
from urllib.parse import (
    SplitResult,
    parse_qsl,
    quote,
    urlsplit,
    urlunsplit,
    uses_netloc,
    uses_relative,
)

import idna
from multidict import MultiDict, MultiDictProxy, istr

from ._helpers import cached_property
from ._quoting import _Quoter, _Unquoter

DEFAULT_PORTS = {"http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21}
USES_AUTHORITY = frozenset(uses_netloc)
USES_RELATIVE = frozenset(uses_relative)

# Special schemes https://url.spec.whatwg.org/#special-scheme
# are not allowed to have an empty host https://url.spec.whatwg.org/#url-representation
SCHEME_REQUIRES_HOST = frozenset(("http", "https", "ws", "wss", "ftp"))

sentinel = object()

# reg-name: unreserved / pct-encoded / sub-delims
# this pattern matches anything that is *not* in those classes. and is only used
# on lower-cased ASCII values.
_not_reg_name = re.compile(
    r"""
        # any character not in the unreserved or sub-delims sets, plus %
        # (validated with the additional check for pct-encoded sequences below)
        [^a-z0-9\-._~!$&'()*+,;=%]
    |
        # % only allowed if it is part of a pct-encoded
        # sequence of 2 hex digits.
        %(?![0-9a-f]{2})
    """,
    re.VERBOSE,
)

SimpleQuery = Union[str, int, float]
QueryVariable = Union[SimpleQuery, "Sequence[SimpleQuery]"]
Query = Union[
    None, str, "Mapping[str, QueryVariable]", "Sequence[Tuple[str, QueryVariable]]"
]
_T = TypeVar("_T")

if sys.version_info >= (3, 11):
    from typing import Self
else:
    Self = Any


class CacheInfo(TypedDict):
    """Host encoding cache."""

    idna_encode: _CacheInfo
    idna_decode: _CacheInfo
    ip_address: _CacheInfo
    host_validate: _CacheInfo


class _SplitResultDict(TypedDict, total=False):

    scheme: str
    netloc: str
    path: str
    query: str
    fragment: str


class _InternalURLCache(TypedDict, total=False):

    absolute: bool
    scheme: str
    raw_authority: str
    _default_port: Union[int, None]
    _port_not_default: Union[int, None]
    authority: str
    raw_user: Union[str, None]
    user: Union[str, None]
    raw_password: Union[str, None]
    password: Union[str, None]
    raw_host: Union[str, None]
    host: Union[str, None]
    port: Union[int, None]
    explicit_port: Union[int, None]
    raw_path: str
    path: str
    _parsed_query: List[Tuple[str, str]]
    query: "MultiDictProxy[str]"
    raw_query_string: str
    query_string: str
    path_qs: str
    raw_path_qs: str
    raw_fragment: str
    fragment: str
    raw_parts: Tuple[str, ...]
    parts: Tuple[str, ...]
    parent: "URL"
    raw_name: str
    name: str
    raw_suffix: str
    suffix: str
    raw_suffixes: Tuple[str, ...]
    suffixes: Tuple[str, ...]


def rewrite_module(obj: _T) -> _T:
    obj.__module__ = "yarl"
    return obj


def _normalize_path_segments(segments: "Sequence[str]") -> List[str]:
    """Drop '.' and '..' from a sequence of str segments"""

    resolved_path: List[str] = []

    for seg in segments:
        if seg == "..":
            # ignore any .. segments that would otherwise cause an
            # IndexError when popped from resolved_path if
            # resolving for rfc3986
            with suppress(IndexError):
                resolved_path.pop()
        elif seg != ".":
            resolved_path.append(seg)

    if segments and segments[-1] in (".", ".."):
        # do some post-processing here.
        # if the last segment was a relative dir,
        # then we need to append the trailing '/'
        resolved_path.append("")

    return resolved_path


@rewrite_module
class URL:
    # Don't derive from str
    # follow pathlib.Path design
    # probably URL will not suffer from pathlib problems:
    # it's intended for libraries like aiohttp,
    # not to be passed into standard library functions like os.open etc.

    # URL grammar (RFC 3986)
    # pct-encoded = "%" HEXDIG HEXDIG
    # reserved    = gen-delims / sub-delims
    # gen-delims  = ":" / "/" / "?" / "#" / "[" / "]" / "@"
    # sub-delims  = "!" / "$" / "&" / "'" / "(" / ")"
    #             / "*" / "+" / "," / ";" / "="
    # unreserved  = ALPHA / DIGIT / "-" / "." / "_" / "~"
    # URI         = scheme ":" hier-part [ "?" query ] [ "#" fragment ]
    # hier-part   = "//" authority path-abempty
    #             / path-absolute
    #             / path-rootless
    #             / path-empty
    # scheme      = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
    # authority   = [ userinfo "@" ] host [ ":" port ]
    # userinfo    = *( unreserved / pct-encoded / sub-delims / ":" )
    # host        = IP-literal / IPv4address / reg-name
    # IP-literal = "[" ( IPv6address / IPvFuture  ) "]"
    # IPvFuture  = "v" 1*HEXDIG "." 1*( unreserved / sub-delims / ":" )
    # IPv6address =                            6( h16 ":" ) ls32
    #             /                       "::" 5( h16 ":" ) ls32
    #             / [               h16 ] "::" 4( h16 ":" ) ls32
    #             / [ *1( h16 ":" ) h16 ] "::" 3( h16 ":" ) ls32
    #             / [ *2( h16 ":" ) h16 ] "::" 2( h16 ":" ) ls32
    #             / [ *3( h16 ":" ) h16 ] "::"    h16 ":"   ls32
    #             / [ *4( h16 ":" ) h16 ] "::"              ls32
    #             / [ *5( h16 ":" ) h16 ] "::"              h16
    #             / [ *6( h16 ":" ) h16 ] "::"
    # ls32        = ( h16 ":" h16 ) / IPv4address
    #             ; least-significant 32 bits of address
    # h16         = 1*4HEXDIG
    #             ; 16 bits of address represented in hexadecimal
    # IPv4address = dec-octet "." dec-octet "." dec-octet "." dec-octet
    # dec-octet   = DIGIT                 ; 0-9
    #             / %x31-39 DIGIT         ; 10-99
    #             / "1" 2DIGIT            ; 100-199
    #             / "2" %x30-34 DIGIT     ; 200-249
    #             / "25" %x30-35          ; 250-255
    # reg-name    = *( unreserved / pct-encoded / sub-delims )
    # port        = *DIGIT
    # path          = path-abempty    ; begins with "/" or is empty
    #               / path-absolute   ; begins with "/" but not "//"
    #               / path-noscheme   ; begins with a non-colon segment
    #               / path-rootless   ; begins with a segment
    #               / path-empty      ; zero characters
    # path-abempty  = *( "/" segment )
    # path-absolute = "/" [ segment-nz *( "/" segment ) ]
    # path-noscheme = segment-nz-nc *( "/" segment )
    # path-rootless = segment-nz *( "/" segment )
    # path-empty    = 0<pchar>
    # segment       = *pchar
    # segment-nz    = 1*pchar
    # segment-nz-nc = 1*( unreserved / pct-encoded / sub-delims / "@" )
    #               ; non-zero-length segment without any colon ":"
    # pchar         = unreserved / pct-encoded / sub-delims / ":" / "@"
    # query       = *( pchar / "/" / "?" )
    # fragment    = *( pchar / "/" / "?" )
    # URI-reference = URI / relative-ref
    # relative-ref  = relative-part [ "?" query ] [ "#" fragment ]
    # relative-part = "//" authority path-abempty
    #               / path-absolute
    #               / path-noscheme
    #               / path-empty
    # absolute-URI  = scheme ":" hier-part [ "?" query ]
    __slots__ = ("_cache", "_val")

    _QUOTER = _Quoter(requote=False)
    _REQUOTER = _Quoter()
    _PATH_QUOTER = _Quoter(safe="@:", protected="/+", requote=False)
    _PATH_REQUOTER = _Quoter(safe="@:", protected="/+")
    _QUERY_QUOTER = _Quoter(safe="?/:@", protected="=+&;", qs=True, requote=False)
    _QUERY_REQUOTER = _Quoter(safe="?/:@", protected="=+&;", qs=True)
    _QUERY_PART_QUOTER = _Quoter(safe="?/:@", qs=True, requote=False)
    _FRAGMENT_QUOTER = _Quoter(safe="?/:@", requote=False)
    _FRAGMENT_REQUOTER = _Quoter(safe="?/:@")

    _UNQUOTER = _Unquoter()
    _PATH_UNQUOTER = _Unquoter(unsafe="+")
    _PATH_SAFE_UNQUOTER = _Unquoter(ignore="/%", unsafe="+")
    _QS_UNQUOTER = _Unquoter(qs=True)

    _val: SplitResult

    def __new__(
        cls,
        val: Union[str, SplitResult, "URL"] = "",
        *,
        encoded: bool = False,
        strict: Union[bool, None] = None,
    ) -> Self:
        if strict is not None:  # pragma: no cover
            warnings.warn("strict parameter is ignored")
        if type(val) is cls:
            return val
        if type(val) is str:
            val = urlsplit(val)
        elif type(val) is SplitResult:
            if not encoded:
                raise ValueError("Cannot apply decoding to SplitResult")
        elif isinstance(val, str):
            val = urlsplit(str(val))
        else:
            raise TypeError("Constructor parameter should be str")

        cache: _InternalURLCache = {}
        if not encoded:
            host: Union[str, None]
            scheme, netloc, path, query, fragment = val
            if not netloc:  # netloc
                host = ""
            else:
                username, password, host, port = cls._split_netloc(val[1])
                if host is None:
                    if scheme in SCHEME_REQUIRES_HOST:
                        msg = (
                            "Invalid URL: host is required for "
                            f"absolute urls with the {scheme} scheme"
                        )
                        raise ValueError(msg)
                    else:
                        host = ""
                host = cls._encode_host(host, validate_host=False)
                raw_user = None if username is None else cls._REQUOTER(username)
                raw_password = None if password is None else cls._REQUOTER(password)
                netloc = cls._make_netloc(
                    raw_user, raw_password, host, port, encode_host=False
                )
                if "[" in host:
                    # Our host encoder adds back brackets for IPv6 addresses
                    # so we need to remove them here to get the raw host
                    _, _, bracketed = host.partition("[")
                    raw_host, _, _ = bracketed.partition("]")
                else:
                    raw_host = host
                cache["raw_host"] = raw_host
                cache["raw_user"] = raw_user
                cache["raw_password"] = raw_password
                cache["explicit_port"] = port

            if path:
                path = cls._PATH_REQUOTER(path)
                if netloc:
                    path = cls._normalize_path(path)

            cls._validate_authority_uri_abs_path(host=host, path=path)
            query = cls._QUERY_REQUOTER(query) if query else query
            fragment = cls._FRAGMENT_REQUOTER(fragment) if fragment else fragment
            cache["scheme"] = scheme
            cache["raw_query_string"] = query
            cache["raw_fragment"] = fragment
            val = SplitResult(scheme, netloc, path, query, fragment)

        self = object.__new__(cls)
        self._val = val
        self._cache = cache
        return self

    @classmethod
    def build(
        cls,
        *,
        scheme: str = "",
        authority: str = "",
        user: Union[str, None] = None,
        password: Union[str, None] = None,
        host: str = "",
        port: Union[int, None] = None,
        path: str = "",
        query: Union[Query, None] = None,
        query_string: str = "",
        fragment: str = "",
        encoded: bool = False,
    ) -> "URL":
        """Creates and returns a new URL"""

        if authority and (user or password or host or port):
            raise ValueError(
                'Can\'t mix "authority" with "user", "password", "host" or "port".'
            )
        if not isinstance(port, (int, type(None))):
            raise TypeError("The port is required to be int.")
        if port and not host:
            raise ValueError('Can\'t build URL with "port" but without "host".')
        if query and query_string:
            raise ValueError('Only one of "query" or "query_string" should be passed')
        if (
            scheme is None
            or authority is None
            or host is None
            or path is None
            or query_string is None
            or fragment is None
        ):
            raise TypeError(
                'NoneType is illegal for "scheme", "authority", "host", "path", '
                '"query_string", and "fragment" args, use empty string instead.'
            )

        if authority:
            if encoded:
                netloc = authority
            else:
                _user, _password, _host, _port = cls._split_netloc(authority)
                port = None if _port == DEFAULT_PORTS.get(scheme) else _port
                _host = (
                    ""
                    if _host is None
                    else cls._encode_host(_host, validate_host=False)
                )
                netloc = cls._make_netloc(
                    _user, _password, _host, port, encode=True, encode_host=False
                )
        elif not user and not password and not host and not port:
            netloc = ""
        else:
            port = None if port == DEFAULT_PORTS.get(scheme) else port
            netloc = cls._make_netloc(
                user, password, host, port, encode=not encoded, encode_host=not encoded
            )
        if not encoded:
            path = cls._PATH_QUOTER(path) if path else path
            if path and netloc:
                path = cls._normalize_path(path)

            cls._validate_authority_uri_abs_path(host=host, path=path)
            query_string = (
                cls._QUERY_QUOTER(query_string) if query_string else query_string
            )
            fragment = cls._FRAGMENT_QUOTER(fragment) if fragment else fragment

        url = cls(
            SplitResult(scheme, netloc, path, query_string, fragment), encoded=True
        )

        if query:
            return url.with_query(query)
        return url

    def __init_subclass__(cls):
        raise TypeError(f"Inheriting a class {cls!r} from URL is forbidden")

    def __str__(self) -> str:
        val = self._val
        if not val.path and self.absolute and (val.query or val.fragment):
            val = val._replace(path="/")
        if (port := self._port_not_default) is None:
            # port normalization - using None for default ports to remove from rendering
            # https://datatracker.ietf.org/doc/html/rfc3986.html#section-6.2.3
            val = val._replace(
                netloc=self._make_netloc(
                    self.raw_user,
                    self.raw_password,
                    self.host_subcomponent,
                    port,
                    encode_host=False,
                )
            )
        return urlunsplit(val)

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}('{str(self)}')"

    def __bytes__(self) -> bytes:
        return str(self).encode("ascii")

    def __eq__(self, other: object) -> bool:
        if type(other) is not URL:
            return NotImplemented

        val1 = self._val
        if not val1.path and self.absolute:
            val1 = val1._replace(path="/")

        val2 = other._val
        if not val2.path and other.absolute:
            val2 = val2._replace(path="/")

        return val1 == val2

    def __hash__(self) -> int:
        ret = self._cache.get("hash")
        if ret is None:
            val = self._val
            if not val.path and self.absolute:
                val = val._replace(path="/")
            ret = self._cache["hash"] = hash(val)
        return ret

    def __le__(self, other: object) -> bool:
        if type(other) is not URL:
            return NotImplemented
        return self._val <= other._val

    def __lt__(self, other: object) -> bool:
        if type(other) is not URL:
            return NotImplemented
        return self._val < other._val

    def __ge__(self, other: object) -> bool:
        if type(other) is not URL:
            return NotImplemented
        return self._val >= other._val

    def __gt__(self, other: object) -> bool:
        if type(other) is not URL:
            return NotImplemented
        return self._val > other._val

    def __truediv__(self, name: str) -> "URL":
        if not isinstance(name, str):
            return NotImplemented
        return self._make_child((str(name),))

    def __mod__(self, query: Query) -> "URL":
        return self.update_query(query)

    def __bool__(self) -> bool:
        return bool(
            self._val.netloc or self._val.path or self._val.query or self._val.fragment
        )

    def __getstate__(self) -> Tuple[SplitResult]:
        return (self._val,)

    def __setstate__(self, state):
        if state[0] is None and isinstance(state[1], dict):
            # default style pickle
            self._val = state[1]["_val"]
        else:
            self._val, *unused = state
        self._cache = {}

    def _cache_netloc(self) -> None:
        """Cache the netloc parts of the URL."""
        cache = self._cache
        (
            cache["raw_user"],
            cache["raw_password"],
            cache["raw_host"],
            cache["explicit_port"],
        ) = self._split_netloc(self._val.netloc)

    def is_absolute(self) -> bool:
        """A check for absolute URLs.

        Return True for absolute ones (having scheme or starting
        with //), False otherwise.

        Is is preferred to call the .absolute property instead
        as it is cached.
        """
        return self.absolute

    def is_default_port(self) -> bool:
        """A check for default port.

        Return True if port is default for specified scheme,
        e.g. 'http://python.org' or 'http://python.org:80', False
        otherwise.

        Return False for relative URLs.

        """
        default = self._default_port
        explicit = self.explicit_port
        if explicit is None:
            # A relative URL does not have an implicit port / default port
            return default is not None
        return explicit == default

    def origin(self) -> "URL":
        """Return an URL with scheme, host and port parts only.

        user, password, path, query and fragment are removed.

        """
        # TODO: add a keyword-only option for keeping user/pass maybe?
        if not self.absolute:
            raise ValueError("URL should be absolute")
        if not self._val.scheme:
            raise ValueError("URL should have scheme")
        v = self._val
        netloc = self._make_netloc(None, None, v.hostname, v.port)
        val = v._replace(netloc=netloc, path="", query="", fragment="")
        return URL(val, encoded=True)

    def relative(self) -> "URL":
        """Return a relative part of the URL.

        scheme, user, password, host and port are removed.

        """
        if not self.absolute:
            raise ValueError("URL should be absolute")
        val = self._val._replace(scheme="", netloc="")
        return URL(val, encoded=True)

    @cached_property
    def absolute(self) -> bool:
        """A check for absolute URLs.

        Return True for absolute ones (having scheme or starting
        with //), False otherwise.

        """
        # `netloc`` is an empty string for relative URLs
        # Checking `netloc` is faster than checking `hostname`
        # because `hostname` is a property that does some extra work
        # to parse the host from the `netloc`
        return self._val.netloc != ""

    @cached_property
    def scheme(self) -> str:
        """Scheme for absolute URLs.

        Empty string for relative URLs or URLs starting with //

        """
        return self._val.scheme

    @cached_property
    def raw_authority(self) -> str:
        """Encoded authority part of URL.

        Empty string for relative URLs.

        """
        return self._val.netloc

    @cached_property
    def _default_port(self) -> Union[int, None]:
        """Default port for the scheme or None if not known."""
        return DEFAULT_PORTS.get(self.scheme)

    @cached_property
    def _port_not_default(self) -> Union[int, None]:
        """The port part of URL normalized to None if its the default port."""
        port = self.port
        if self._default_port == port:
            return None
        return port

    @cached_property
    def authority(self) -> str:
        """Decoded authority part of URL.

        Empty string for relative URLs.

        """
        return self._make_netloc(
            self.user, self.password, self.host, self.port, encode_host=False
        )

    @cached_property
    def raw_user(self) -> Union[str, None]:
        """Encoded user part of URL.

        None if user is missing.

        """
        # not .username
        self._cache_netloc()
        return self._cache["raw_user"]

    @cached_property
    def user(self) -> Union[str, None]:
        """Decoded user part of URL.

        None if user is missing.

        """
        raw_user = self.raw_user
        if raw_user is None:
            return None
        return self._UNQUOTER(raw_user)

    @cached_property
    def raw_password(self) -> Union[str, None]:
        """Encoded password part of URL.

        None if password is missing.

        """
        self._cache_netloc()
        return self._cache["raw_password"]

    @cached_property
    def password(self) -> Union[str, None]:
        """Decoded password part of URL.

        None if password is missing.

        """
        raw_password = self.raw_password
        if raw_password is None:
            return None
        return self._UNQUOTER(raw_password)

    @cached_property
    def raw_host(self) -> Union[str, None]:
        """Encoded host part of URL.

        None for relative URLs.

        When working with IPv6 addresses, use the `host_subcomponent` property instead
        as it will return the host subcomponent with brackets.
        """
        # Use host instead of hostname for sake of shortness
        # May add .hostname prop later
        self._cache_netloc()
        return self._cache["raw_host"]

    @cached_property
    def host(self) -> Union[str, None]:
        """Decoded host part of URL.

        None for relative URLs.

        """
        if (raw := self.raw_host) is None:
            return None
        if raw and raw[-1].isdigit() or ":" in raw:
            # IP addresses are never IDNA encoded
            return raw
        return _idna_decode(raw)

    @cached_property
    def host_subcomponent(self) -> Union[str, None]:
        """Return the host subcomponent part of URL.

        None for relative URLs.

        https://datatracker.ietf.org/doc/html/rfc3986#section-3.2.2

        `IP-literal = "[" ( IPv6address / IPvFuture  ) "]"`

        Examples:
        - `http://example.com:8080` -> `example.com`
        - `http://example.com:80` -> `example.com`
        - `https://127.0.0.1:8443` -> `127.0.0.1`
        - `https://[::1]:8443` -> `[::1]`
        - `http://[::1]` -> `[::1]`

        """
        if (raw := self.raw_host) is None:
            return None
        return f"[{raw}]" if ":" in raw else raw

    @cached_property
    def port(self) -> Union[int, None]:
        """Port part of URL, with scheme-based fallback.

        None for relative URLs or URLs without explicit port and
        scheme without default port substitution.

        """
        return self.explicit_port or self._default_port

    @cached_property
    def explicit_port(self) -> Union[int, None]:
        """Port part of URL, without scheme-based fallback.

        None for relative URLs or URLs without explicit port.

        """
        self._cache_netloc()
        return self._cache["explicit_port"]

    @cached_property
    def raw_path(self) -> str:
        """Encoded path of URL.

        / for absolute URLs without path part.

        """
        ret = self._val.path
        if not ret and self.absolute:
            ret = "/"
        return ret

    @cached_property
    def path(self) -> str:
        """Decoded path of URL.

        / for absolute URLs without path part.

        """
        return self._PATH_UNQUOTER(self.raw_path)

    @cached_property
    def path_safe(self) -> str:
        """Decoded path of URL.

        / for absolute URLs without path part.

        / (%2F) and % (%25) are not decoded

        """
        return self._PATH_SAFE_UNQUOTER(self.raw_path)

    @cached_property
    def _parsed_query(self) -> List[Tuple[str, str]]:
        """Parse query part of URL."""
        return parse_qsl(self.raw_query_string, keep_blank_values=True)

    @cached_property
    def query(self) -> "MultiDictProxy[str]":
        """A MultiDictProxy representing parsed query parameters in decoded
        representation.

        Empty value if URL has no query part.

        """
        return MultiDictProxy(MultiDict(self._parsed_query))

    @cached_property
    def raw_query_string(self) -> str:
        """Encoded query part of URL.

        Empty string if query is missing.

        """
        return self._val.query

    @cached_property
    def query_string(self) -> str:
        """Decoded query part of URL.

        Empty string if query is missing.

        """
        return self._QS_UNQUOTER(self.raw_query_string)

    @cached_property
    def path_qs(self) -> str:
        """Decoded path of URL with query."""
        if not self.query_string:
            return self.path
        return f"{self.path}?{self.query_string}"

    @cached_property
    def raw_path_qs(self) -> str:
        """Encoded path of URL with query."""
        if not self.raw_query_string:
            return self.raw_path
        return f"{self.raw_path}?{self.raw_query_string}"

    @cached_property
    def raw_fragment(self) -> str:
        """Encoded fragment part of URL.

        Empty string if fragment is missing.

        """
        return self._val.fragment

    @cached_property
    def fragment(self) -> str:
        """Decoded fragment part of URL.

        Empty string if fragment is missing.

        """
        return self._UNQUOTER(self.raw_fragment)

    @cached_property
    def raw_parts(self) -> Tuple[str, ...]:
        """A tuple containing encoded *path* parts.

        ('/',) for absolute URLs if *path* is missing.

        """
        path = self._val.path
        if self.absolute:
            if not path:
                parts = ["/"]
            else:
                parts = ["/"] + path[1:].split("/")
        else:
            if path and path[0] == "/":
                parts = ["/"] + path[1:].split("/")
            else:
                parts = path.split("/")
        return tuple(parts)

    @cached_property
    def parts(self) -> Tuple[str, ...]:
        """A tuple containing decoded *path* parts.

        ('/',) for absolute URLs if *path* is missing.

        """
        return tuple(self._UNQUOTER(part) for part in self.raw_parts)

    @cached_property
    def parent(self) -> "URL":
        """A new URL with last part of path removed and cleaned up query and
        fragment.

        """
        path = self.raw_path
        if not path or path == "/":
            if self.raw_fragment or self.raw_query_string:
                return URL(self._val._replace(query="", fragment=""), encoded=True)
            return self
        parts = path.split("/")
        val = self._val._replace(path="/".join(parts[:-1]), query="", fragment="")
        return URL(val, encoded=True)

    @cached_property
    def raw_name(self) -> str:
        """The last part of raw_parts."""
        parts = self.raw_parts
        if self.absolute:
            parts = parts[1:]
            if not parts:
                return ""
            else:
                return parts[-1]
        else:
            return parts[-1]

    @cached_property
    def name(self) -> str:
        """The last part of parts."""
        return self._UNQUOTER(self.raw_name)

    @cached_property
    def raw_suffix(self) -> str:
        name = self.raw_name
        i = name.rfind(".")
        if 0 < i < len(name) - 1:
            return name[i:]
        else:
            return ""

    @cached_property
    def suffix(self) -> str:
        return self._UNQUOTER(self.raw_suffix)

    @cached_property
    def raw_suffixes(self) -> Tuple[str, ...]:
        name = self.raw_name
        if name.endswith("."):
            return ()
        name = name.lstrip(".")
        return tuple("." + suffix for suffix in name.split(".")[1:])

    @cached_property
    def suffixes(self) -> Tuple[str, ...]:
        return tuple(self._UNQUOTER(suffix) for suffix in self.raw_suffixes)

    @staticmethod
    def _validate_authority_uri_abs_path(host: str, path: str) -> None:
        """Ensure that path in URL with authority starts with a leading slash.

        Raise ValueError if not.
        """
        if host and path and not path[0] == "/":
            raise ValueError(
                "Path in a URL with authority should start with a slash ('/') if set"
            )

    def _make_child(self, paths: "Sequence[str]", encoded: bool = False) -> "URL":
        """
        add paths to self._val.path, accounting for absolute vs relative paths,
        keep existing, but do not create new, empty segments
        """
        parsed = []
        for idx, path in enumerate(reversed(paths)):
            # empty segment of last is not removed
            last = idx == 0
            if path and path[0] == "/":
                raise ValueError(
                    f"Appending path {path!r} starting from slash is forbidden"
                )
            path = path if encoded else self._PATH_QUOTER(path)
            segments = list(reversed(path.split("/")))
            # remove trailing empty segment for all but the last path
            segment_slice_start = int(not last and segments[0] == "")
            parsed += segments[segment_slice_start:]
        parsed.reverse()

        if self._val.path and (old_path_segments := self._val.path.split("/")):
            old_path_cutoff = -1 if old_path_segments[-1] == "" else None
            parsed = [*old_path_segments[:old_path_cutoff], *parsed]

        if self.absolute:
            parsed = _normalize_path_segments(parsed)
            if parsed and parsed[0] != "":
                # inject a leading slash when adding a path to an absolute URL
                # where there was none before
                parsed = ["", *parsed]
        new_path = "/".join(parsed)
        return URL(
            self._val._replace(path=new_path, query="", fragment=""), encoded=True
        )

    @classmethod
    def _normalize_path(cls, path: str) -> str:
        # Drop '.' and '..' from str path
        if "." not in path:
            # No need to normalize if there are no '.' or '..' segments
            return path

        prefix = ""
        if path and path[0] == "/":
            # preserve the "/" root element of absolute paths, copying it to the
            # normalised output as per sections 5.2.4 and 6.2.2.3 of rfc3986.
            prefix = "/"
            path = path[1:]

        segments = path.split("/")
        return prefix + "/".join(_normalize_path_segments(segments))

    @classmethod
    def _encode_host(
        cls, host: str, human: bool = False, validate_host: bool = True
    ) -> str:
        if "%" in host:
            raw_ip, sep, zone = host.partition("%")
        else:
            raw_ip = host
            sep = zone = ""

        if raw_ip and raw_ip[-1].isdigit() or ":" in raw_ip:
            # Might be an IP address, check it
            #
            # IP Addresses can look like:
            # https://datatracker.ietf.org/doc/html/rfc3986#section-3.2.2
            # - 127.0.0.1 (last character is a digit)
            # - 2001:db8::ff00:42:8329 (contains a colon)
            # - 2001:db8::ff00:42:8329%eth0 (contains a colon)
            # - [2001:db8::ff00:42:8329] (contains a colon -- brackets should
            #                             have been removed before it gets here)
            # Rare IP Address formats are not supported per:
            # https://datatracker.ietf.org/doc/html/rfc3986#section-7.4
            #
            # We try to avoid parsing IP addresses as much as possible
            # since its orders of magnitude slower than almost any other operation
            # this library does.
            #
            # IP parsing is slow, so its wrapped in an LRU
            try:
                ip_compressed_version = _ip_compressed_version(raw_ip)
            except ValueError:
                pass
            else:
                # These checks should not happen in the
                # LRU to keep the cache size small
                host, version = ip_compressed_version
                if sep:
                    host += "%" + zone
                if version == 6:
                    return f"[{host}]"
                return host

        host = host.lower()
        if human:
            return host

        # IDNA encoding is slow,
        # skip it for ASCII-only strings
        # Don't move the check into _idna_encode() helper
        # to reduce the cache size
        if host.isascii():
            # Check for invalid characters explicitly; _idna_encode() does this
            # for non-ascii host names.
            if validate_host:
                _host_validate(host)
            return host
        return _idna_encode(host)

    @classmethod
    def _make_netloc(
        cls,
        user: Union[str, None],
        password: Union[str, None],
        host: Union[str, None],
        port: Union[int, None],
        encode: bool = False,
        encode_host: bool = True,
        requote: bool = False,
    ) -> str:
        if host is None:
            return ""
        quoter = cls._REQUOTER if requote else cls._QUOTER
        if encode_host:
            ret = cls._encode_host(host)
        else:
            ret = host
        if port is not None:
            ret = f"{ret}:{port}"
        if password is not None:
            if not user:
                user = ""
            else:
                if encode:
                    user = quoter(user)
            if encode:
                password = quoter(password)
            user = user + ":" + password
        elif user and encode:
            user = quoter(user)
        if user:
            ret = user + "@" + ret
        return ret

    @classmethod
    @lru_cache  # match the same size as urlsplit
    def _split_netloc(
        cls,
        netloc: str,
    ) -> Tuple[Union[str, None], Union[str, None], Union[str, None], Union[int, None]]:
        """Split netloc into username, password, host and port."""
        if "@" not in netloc:
            username: Union[str, None] = None
            password: Union[str, None] = None
            hostinfo = netloc
        else:
            userinfo, _, hostinfo = netloc.rpartition("@")
            username, have_password, password = userinfo.partition(":")
            if not have_password:
                password = None

        if "[" in hostinfo:
            _, _, bracketed = hostinfo.partition("[")
            hostname, _, port_str = bracketed.partition("]")
            _, _, port_str = port_str.partition(":")
        else:
            hostname, _, port_str = hostinfo.partition(":")

        if not port_str:
            port: Union[int, None] = None
        else:
            try:
                port = int(port_str)
            except ValueError:
                raise ValueError("Invalid URL: port can't be converted to integer")
            if not (0 <= port <= 65535):
                raise ValueError("Port out of range 0-65535")

        return username or None, password, hostname or None, port

    def with_scheme(self, scheme: str) -> "URL":
        """Return a new URL with scheme replaced."""
        # N.B. doesn't cleanup query/fragment
        if not isinstance(scheme, str):
            raise TypeError("Invalid scheme type")
        if not self.absolute and scheme in SCHEME_REQUIRES_HOST:
            msg = (
                "scheme replacement is not allowed for "
                f"relative URLs for the {scheme} scheme"
            )
            raise ValueError(msg)
        return URL(self._val._replace(scheme=scheme.lower()), encoded=True)

    def with_user(self, user: Union[str, None]) -> "URL":
        """Return a new URL with user replaced.

        Autoencode user if needed.

        Clear user/password if user is None.

        """
        # N.B. doesn't cleanup query/fragment
        val = self._val
        if user is None:
            password = None
        elif isinstance(user, str):
            user = self._QUOTER(user)
            password = val.password
        else:
            raise TypeError("Invalid user type")
        if not self.absolute:
            raise ValueError("user replacement is not allowed for relative URLs")
        return URL(
            self._val._replace(
                netloc=self._make_netloc(user, password, val.hostname, val.port)
            ),
            encoded=True,
        )

    def with_password(self, password: Union[str, None]) -> "URL":
        """Return a new URL with password replaced.

        Autoencode password if needed.

        Clear password if argument is None.

        """
        # N.B. doesn't cleanup query/fragment
        if password is None:
            pass
        elif isinstance(password, str):
            password = self._QUOTER(password)
        else:
            raise TypeError("Invalid password type")
        if not self.absolute:
            raise ValueError("password replacement is not allowed for relative URLs")
        val = self._val
        return URL(
            self._val._replace(
                netloc=self._make_netloc(val.username, password, val.hostname, val.port)
            ),
            encoded=True,
        )

    def with_host(self, host: str) -> "URL":
        """Return a new URL with host replaced.

        Autoencode host if needed.

        Changing host for relative URLs is not allowed, use .join()
        instead.

        """
        # N.B. doesn't cleanup query/fragment
        if not isinstance(host, str):
            raise TypeError("Invalid host type")
        if not self.absolute:
            raise ValueError("host replacement is not allowed for relative URLs")
        if not host:
            raise ValueError("host removing is not allowed")
        val = self._val
        return URL(
            self._val._replace(
                netloc=self._make_netloc(val.username, val.password, host, val.port)
            ),
            encoded=True,
        )

    def with_port(self, port: Union[int, None]) -> "URL":
        """Return a new URL with port replaced.

        Clear port to default if None is passed.

        """
        # N.B. doesn't cleanup query/fragment
        if port is not None:
            if isinstance(port, bool) or not isinstance(port, int):
                raise TypeError(f"port should be int or None, got {type(port)}")
            if port < 0 or port > 65535:
                raise ValueError(f"port must be between 0 and 65535, got {port}")
        if not self.absolute:
            raise ValueError("port replacement is not allowed for relative URLs")
        val = self._val
        return URL(
            self._val._replace(
                netloc=self._make_netloc(val.username, val.password, val.hostname, port)
            ),
            encoded=True,
        )

    def with_path(self, path: str, *, encoded: bool = False) -> "URL":
        """Return a new URL with path replaced."""
        if not encoded:
            path = self._PATH_QUOTER(path)
            if self.absolute:
                path = self._normalize_path(path)
        if len(path) > 0 and path[0] != "/":
            path = "/" + path
        return URL(self._val._replace(path=path, query="", fragment=""), encoded=True)

    @classmethod
    def _query_seq_pairs(
        cls, quoter: Callable[[str], str], pairs: Iterable[Tuple[str, QueryVariable]]
    ) -> Iterator[str]:
        for key, val in pairs:
            if isinstance(val, (list, tuple)):
                for v in val:
                    yield quoter(key) + "=" + quoter(cls._query_var(v))
            else:
                yield quoter(key) + "=" + quoter(cls._query_var(val))

    @staticmethod
    def _query_var(v: QueryVariable) -> str:
        cls = type(v)
        if cls is str or issubclass(cls, str):
            if TYPE_CHECKING:
                assert isinstance(v, str)
            return v
        if issubclass(cls, float):
            if TYPE_CHECKING:
                assert isinstance(v, float)
            if math.isinf(v):
                raise ValueError("float('inf') is not supported")
            if math.isnan(v):
                raise ValueError("float('nan') is not supported")
            return str(float(v))
        if cls is not bool and isinstance(cls, SupportsInt):
            return str(int(v))
        raise TypeError(
            "Invalid variable type: value "
            "should be str, int or float, got {!r} "
            "of type {}".format(v, cls)
        )

    def _get_str_query_from_iterable(
        self, items: Iterable[Tuple[Union[str, istr], str]]
    ) -> str:
        """Return a query string from an iterable."""
        quoter = self._QUERY_PART_QUOTER
        # A listcomp is used since listcomps are inlined on CPython 3.12+ and
        # they are a bit faster than a generator expression.
        return "&".join([f"{quoter(k)}={quoter(self._query_var(v))}" for k, v in items])

    def _get_str_query(self, *args: Any, **kwargs: Any) -> Union[str, None]:
        query: Union[str, Mapping[str, QueryVariable], None]
        if kwargs:
            if len(args) > 0:
                raise ValueError(
                    "Either kwargs or single query parameter must be present"
                )
            query = kwargs
        elif len(args) == 1:
            query = args[0]
        else:
            raise ValueError("Either kwargs or single query parameter must be present")

        if query is None:
            return None
        if isinstance(query, Mapping):
            quoter = self._QUERY_PART_QUOTER
            return "&".join(self._query_seq_pairs(quoter, query.items()))
        if isinstance(query, str):
            return self._QUERY_QUOTER(query)
        if isinstance(query, (bytes, bytearray, memoryview)):
            raise TypeError(
                "Invalid query type: bytes, bytearray and memoryview are forbidden"
            )
        if isinstance(query, Sequence):
            # We don't expect sequence values if we're given a list of pairs
            # already; only mappings like builtin `dict` which can't have the
            # same key pointing to multiple values are allowed to use
            # `_query_seq_pairs`.
            return self._get_str_query_from_iterable(query)

        raise TypeError(
            "Invalid query type: only str, mapping or "
            "sequence of (key, value) pairs is allowed"
        )

    @overload
    def with_query(self, query: Query) -> "URL": ...

    @overload
    def with_query(self, **kwargs: QueryVariable) -> "URL": ...

    def with_query(self, *args: Any, **kwargs: Any) -> "URL":
        """Return a new URL with query part replaced.

        Accepts any Mapping (e.g. dict, multidict.MultiDict instances)
        or str, autoencode the argument if needed.

        A sequence of (key, value) pairs is supported as well.

        It also can take an arbitrary number of keyword arguments.

        Clear query if None is passed.

        """
        # N.B. doesn't cleanup query/fragment

        new_query = self._get_str_query(*args, **kwargs) or ""
        return URL(self._val._replace(query=new_query), encoded=True)

    @overload
    def extend_query(self, query: Query) -> "URL": ...

    @overload
    def extend_query(self, **kwargs: QueryVariable) -> "URL": ...

    def extend_query(self, *args: Any, **kwargs: Any) -> "URL":
        """Return a new URL with query part combined with the existing.

        This method will not remove existing query parameters.

        Example:
        >>> url = URL('http://example.com/?a=1&b=2')
        >>> url.extend_query(a=3, c=4)
        URL('http://example.com/?a=1&b=2&a=3&c=4')
        """
        new_query_string = self._get_str_query(*args, **kwargs)
        if not new_query_string:
            return self
        if current_query := self.raw_query_string:
            # both strings are already encoded so we can use a simple
            # string join
            if current_query[-1] == "&":
                combined_query = f"{current_query}{new_query_string}"
            else:
                combined_query = f"{current_query}&{new_query_string}"
        else:
            combined_query = new_query_string
        return URL(self._val._replace(query=combined_query), encoded=True)

    @overload
    def update_query(self, query: Query) -> "URL": ...

    @overload
    def update_query(self, **kwargs: QueryVariable) -> "URL": ...

    def update_query(self, *args: Any, **kwargs: Any) -> "URL":
        """Return a new URL with query part updated.

        This method will overwrite existing query parameters.

        Example:
        >>> url = URL('http://example.com/?a=1&b=2')
        >>> url.update_query(a=3, c=4)
        URL('http://example.com/?a=3&b=2&c=4')
        """
        s = self._get_str_query(*args, **kwargs)
        if s is None:
            return URL(self._val._replace(query=""), encoded=True)

        query = MultiDict(self._parsed_query)
        query.update(parse_qsl(s, keep_blank_values=True))
        new_str = self._get_str_query_from_iterable(query.items())
        return URL(self._val._replace(query=new_str), encoded=True)

    def without_query_params(self, *query_params: str) -> "URL":
        """Remove some keys from query part and return new URL."""
        params_to_remove = set(query_params) & self.query.keys()
        if not params_to_remove:
            return self
        return self.with_query(
            tuple(
                (name, value)
                for name, value in self.query.items()
                if name not in params_to_remove
            )
        )

    def with_fragment(self, fragment: Union[str, None]) -> "URL":
        """Return a new URL with fragment replaced.

        Autoencode fragment if needed.

        Clear fragment to default if None is passed.

        """
        # N.B. doesn't cleanup query/fragment
        if fragment is None:
            raw_fragment = ""
        elif not isinstance(fragment, str):
            raise TypeError("Invalid fragment type")
        else:
            raw_fragment = self._FRAGMENT_QUOTER(fragment)
        if self.raw_fragment == raw_fragment:
            return self
        return URL(self._val._replace(fragment=raw_fragment), encoded=True)

    def with_name(self, name: str) -> "URL":
        """Return a new URL with name (last part of path) replaced.

        Query and fragment parts are cleaned up.

        Name is encoded if needed.

        """
        # N.B. DOES cleanup query/fragment
        if not isinstance(name, str):
            raise TypeError("Invalid name type")
        if "/" in name:
            raise ValueError("Slash in name is not allowed")
        name = self._PATH_QUOTER(name)
        if name in (".", ".."):
            raise ValueError(". and .. values are forbidden")
        parts = list(self.raw_parts)
        if self.absolute:
            if len(parts) == 1:
                parts.append(name)
            else:
                parts[-1] = name
            parts[0] = ""  # replace leading '/'
        else:
            parts[-1] = name
            if parts[0] == "/":
                parts[0] = ""  # replace leading '/'
        return URL(
            self._val._replace(path="/".join(parts), query="", fragment=""),
            encoded=True,
        )

    def with_suffix(self, suffix: str) -> "URL":
        """Return a new URL with suffix (file extension of name) replaced.

        Query and fragment parts are cleaned up.

        suffix is encoded if needed.
        """
        if not isinstance(suffix, str):
            raise TypeError("Invalid suffix type")
        if suffix and not suffix[0] == "." or suffix == ".":
            raise ValueError(f"Invalid suffix {suffix!r}")
        name = self.raw_name
        if not name:
            raise ValueError(f"{self!r} has an empty name")
        old_suffix = self.raw_suffix
        if not old_suffix:
            name = name + suffix
        else:
            name = name[: -len(old_suffix)] + suffix
        return self.with_name(name)

    def join(self, url: "URL") -> "URL":
        """Join URLs

        Construct a full (“absolute”) URL by combining a “base URL”
        (self) with another URL (url).

        Informally, this uses components of the base URL, in
        particular the addressing scheme, the network location and
        (part of) the path, to provide missing components in the
        relative URL.

        """
        if type(url) is not URL:
            raise TypeError("url should be URL")
        val = self._val
        other_val = url._val
        scheme = other_val.scheme or val.scheme

        if scheme != val.scheme or scheme not in USES_RELATIVE:
            return url

        # scheme is in uses_authority as uses_authority is a superset of uses_relative
        if other_val.netloc and scheme in USES_AUTHORITY:
            return URL(other_val._replace(scheme=scheme), encoded=True)

        parts: _SplitResultDict = {"scheme": scheme}
        if other_val.path or other_val.fragment:
            parts["fragment"] = other_val.fragment
        if other_val.path or other_val.query:
            parts["query"] = other_val.query

        if not other_val.path:
            return URL(val._replace(**parts), encoded=True)

        if other_val.path[0] == "/":
            path = other_val.path
        elif not val.path:
            path = f"/{other_val.path}"
        elif val.path[-1] == "/":
            path = f"{val.path}{other_val.path}"
        else:
            # …
            # and relativizing ".."
            # parts[0] is / for absolute urls, this join will add a double slash there
            path = "/".join([*self.parts[:-1], ""])
            path += other_val.path
            # which has to be removed
            if val.path[0] == "/":
                path = path[1:]

        parts["path"] = self._normalize_path(path)
        return URL(val._replace(**parts), encoded=True)

    def joinpath(self, *other: str, encoded: bool = False) -> "URL":
        """Return a new URL with the elements in other appended to the path."""
        return self._make_child(other, encoded=encoded)

    def human_repr(self) -> str:
        """Return decoded human readable string for URL representation."""
        user = _human_quote(self.user, "#/:?@[]")
        password = _human_quote(self.password, "#/:?@[]")
        host = self.host
        if host:
            host = self._encode_host(host, human=True)
        path = _human_quote(self.path, "#?")
        if TYPE_CHECKING:
            assert path is not None
        query_string = "&".join(
            "{}={}".format(_human_quote(k, "#&+;="), _human_quote(v, "#&+;="))
            for k, v in self.query.items()
        )
        fragment = _human_quote(self.fragment, "")
        if TYPE_CHECKING:
            assert fragment is not None
        netloc = self._make_netloc(
            user, password, host, self.explicit_port, encode_host=False
        )
        val = SplitResult(self.scheme, netloc, path, query_string, fragment)
        return urlunsplit(val)


def _human_quote(s: Union[str, None], unsafe: str) -> Union[str, None]:
    if not s:
        return s
    for c in "%" + unsafe:
        if c in s:
            s = s.replace(c, f"%{ord(c):02X}")
    if s.isprintable():
        return s
    return "".join(c if c.isprintable() else quote(c) for c in s)


_MAXCACHE = 256


@lru_cache(_MAXCACHE)
def _idna_decode(raw: str) -> str:
    try:
        return idna.decode(raw.encode("ascii"))
    except UnicodeError:  # e.g. '::1'
        return raw.encode("ascii").decode("idna")


@lru_cache(_MAXCACHE)
def _idna_encode(host: str) -> str:
    try:
        return idna.encode(host, uts46=True).decode("ascii")
    except UnicodeError:
        return host.encode("idna").decode("ascii")


@lru_cache(_MAXCACHE)
def _ip_compressed_version(raw_ip: str) -> Tuple[str, int]:
    """Return compressed version of IP address and its version."""
    ip = ip_address(raw_ip)
    return ip.compressed, ip.version


@lru_cache(_MAXCACHE)
def _host_validate(host: str) -> None:
    """Validate an ascii host name."""
    invalid = _not_reg_name.search(host)
    if invalid is None:
        return
    value, pos, extra = invalid.group(), invalid.start(), ""
    if value == "@" or (value == ":" and "@" in host[pos:]):
        # this looks like an authority string
        extra = (
            ", if the value includes a username or password, "
            "use 'authority' instead of 'host'"
        )
    raise ValueError(
        f"Host {host!r} cannot contain {value!r} (at position " f"{pos}){extra}"
    ) from None


@rewrite_module
def cache_clear() -> None:
    """Clear all LRU caches."""
    _idna_decode.cache_clear()
    _idna_encode.cache_clear()
    _ip_compressed_version.cache_clear()
    _host_validate.cache_clear()


@rewrite_module
def cache_info() -> CacheInfo:
    """Report cache statistics."""
    return {
        "idna_encode": _idna_encode.cache_info(),
        "idna_decode": _idna_decode.cache_info(),
        "ip_address": _ip_compressed_version.cache_info(),
        "host_validate": _host_validate.cache_info(),
    }


@rewrite_module
def cache_configure(
    *,
    idna_encode_size: Union[int, None] = _MAXCACHE,
    idna_decode_size: Union[int, None] = _MAXCACHE,
    ip_address_size: Union[int, None] = _MAXCACHE,
    host_validate_size: Union[int, None] = _MAXCACHE,
) -> None:
    """Configure LRU cache sizes."""
    global _idna_decode, _idna_encode, _ip_compressed_version, _host_validate

    _idna_encode = lru_cache(idna_encode_size)(_idna_encode.__wrapped__)
    _idna_decode = lru_cache(idna_decode_size)(_idna_decode.__wrapped__)
    _ip_compressed_version = lru_cache(ip_address_size)(
        _ip_compressed_version.__wrapped__
    )
    _host_validate = lru_cache(host_validate_size)(_host_validate.__wrapped__)
