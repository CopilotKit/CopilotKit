"""Portable Learning Contract V1 schema validator.

The language-neutral conformance corpus (``learning-platform-v1.json``) is the
specification for the Learning Platform wire contracts. Most of it is ordinary
JSON Schema Draft 2020-12, but the safety-bearing negative cases — path and
Unicode collisions, subject-hash equality, ordering, bounded JSON trees, and the
inline-payload key vocabulary that keeps user data out of downloadable Skills —
are only expressed through two custom keywords:

* ``x-copilotkit-equal-properties``
* ``x-copilotkit-assertions``

A validator that ignores those keywords accepts 112 of the corpus's negative
cases. This module is the Python peer of
``packages/intelligence/src/portable-validator.ts`` so that every corpus case is
enforced identically in TypeScript, Python, and C#.

Two deliberate design choices keep the three implementations from drifting:

* Unknown schema keywords are a hard error rather than an ignored annotation. A
  future corpus keyword therefore fails loudly here instead of silently
  under-enforcing.
* ECMAScript ``pattern`` values are translated into Python's dialect explicitly.
  Left untranslated, ``$`` would also match before a trailing newline and ``\\d``
  would match non-ASCII digits, so this validator would accept strings the
  TypeScript validator rejects.
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Callable, Iterable, Mapping, Sequence

from .unicode_default_case_folding import unicode_default_case_fold

__all__ = [
    "COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD",
    "COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD",
    "COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI",
    "INLINE_ATTACHMENT_PAYLOAD_KEY_NORMALIZATION_V1",
    "LearningContractValidatorError",
    "compile_learning_contract_schema",
    "normalize_inline_attachment_payload_key_v1",
    "utf8_byte_length",
    "validate_learning_contract",
]

COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD = "x-copilotkit-equal-properties"
COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD = "x-copilotkit-assertions"
COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI = (
    "https://copilotkit.ai/schemas/intelligence/learning-platform/v1"
    "/candidate-semantics"
)

INLINE_ATTACHMENT_PAYLOAD_KEY_NORMALIZATION_V1 = {
    "unicodeNormalization": "NFKC",
    "caseNormalization": "lowercase",
    "ignoredCodePointClasses": (
        "White_Space",
        "Dash_Punctuation",
        "Connector_Punctuation",
    ),
}

# Unicode's White_Space binary property is not exposed by ``unicodedata``. The
# set has been stable since Unicode 4.1 and is spelled out so that the value can
# never silently depend on the interpreter's Unicode version.
_WHITE_SPACE_CODE_POINTS = frozenset(
    {
        0x0009,
        0x000A,
        0x000B,
        0x000C,
        0x000D,
        0x0020,
        0x0085,
        0x00A0,
        0x1680,
        0x2000,
        0x2001,
        0x2002,
        0x2003,
        0x2004,
        0x2005,
        0x2006,
        0x2007,
        0x2008,
        0x2009,
        0x200A,
        0x2028,
        0x2029,
        0x202F,
        0x205F,
        0x3000,
    }
)


class LearningContractValidatorError(Exception):
    """The schema uses a construct this validator refuses to guess about."""


_MISSING = object()


def _is_object(value: Any) -> bool:
    return isinstance(value, dict)


def _is_array(value: Any) -> bool:
    return isinstance(value, list)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _json_equal(left: Any, right: Any) -> bool:
    """JSON value equality with JavaScript's type discipline.

    ``True == 1`` in Python but ``true !== 1`` in JavaScript, so booleans are
    compared only against booleans.
    """
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left is right
    if left is None or right is None:
        return left is None and right is None
    if _is_number(left) and _is_number(right):
        return left == right
    if isinstance(left, str) and isinstance(right, str):
        return left == right
    if _is_array(left) and _is_array(right):
        return len(left) == len(right) and all(
            _json_equal(one, other) for one, other in zip(left, right)
        )
    if _is_object(left) and _is_object(right):
        return left.keys() == right.keys() and all(
            _json_equal(left[key], right[key]) for key in left
        )
    return False


# --------------------------------------------------------------------------- #
# UTF-8 accounting                                                            #
# --------------------------------------------------------------------------- #


def utf8_byte_length(value: str) -> int:
    """UTF-8 length, counting lone surrogates as three bytes like the JS peer."""
    total = 0
    for character in value:
        code_point = ord(character)
        if code_point < 0x80:
            total += 1
        elif code_point < 0x800:
            total += 2
        elif code_point < 0x10000:
            total += 3
        else:
            total += 4
    return total


def _json_string_byte_length(value: str) -> int:
    """Serialized UTF-8 length of a JSON string, including quotes and escapes."""
    total = 2
    for character in value:
        code_point = ord(character)
        if code_point in (0x22, 0x5C):
            total += 2
        elif code_point in (0x08, 0x09, 0x0A, 0x0C, 0x0D):
            total += 2
        elif code_point < 0x20:
            total += 6
        elif code_point < 0x80:
            total += 1
        elif code_point < 0x800:
            total += 2
        elif 0xD800 <= code_point <= 0xDFFF:
            total += 6
        elif code_point < 0x10000:
            total += 3
        else:
            total += 4
    return total


# --------------------------------------------------------------------------- #
# JavaScript-compatible JSON serialization for assertion keys                  #
# --------------------------------------------------------------------------- #


def _js_number(value: int | float) -> str:
    """Renders a number the way ``String(value)`` does in JavaScript."""
    if isinstance(value, int):
        return str(value)
    if value != value or value in (float("inf"), float("-inf")):
        raise LearningContractValidatorError("Non-finite numbers are not JSON")
    if value == int(value) and abs(value) < 1e21:
        return str(int(value))
    rendered = repr(value)
    if "e" in rendered:
        mantissa, _, exponent = rendered.partition("e")
        sign = "+" if not exponent.startswith("-") else "-"
        digits = exponent.lstrip("+-").lstrip("0") or "0"
        rendered = f"{mantissa}e{sign}{digits}"
    return rendered


def _js_json(value: Any) -> str:
    """``JSON.stringify`` for JSON values, matching JavaScript byte for byte."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if _is_number(value):
        return _js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if _is_array(value):
        return "[" + ",".join(_js_json(item) for item in value) + "]"
    if _is_object(value):
        return (
            "{"
            + ",".join(
                f"{json.dumps(key, ensure_ascii=False)}:{_js_json(item)}"
                for key, item in value.items()
            )
            + "}"
        )
    raise LearningContractValidatorError(f"Not a JSON value: {value!r}")


def _js_typeof(value: Any) -> str:
    if value is None:
        return "object"
    if isinstance(value, bool):
        return "boolean"
    if _is_number(value):
        return "number"
    if isinstance(value, str):
        return "string"
    return "object"


# --------------------------------------------------------------------------- #
# ECMAScript pattern translation                                              #
# --------------------------------------------------------------------------- #

_MAX_CODE_POINT = 0x10FFFF
# The exact ECMAScript character-class shorthands. Python's \d and \w are
# Unicode-aware and Python's \s disagrees with JavaScript's at U+001C-U+001F and
# U+FEFF, so each shorthand is expanded into explicit code point ranges instead
# of being passed through.
_JS_SHORTHAND_RANGES: Mapping[str, tuple[tuple[int, int], ...]] = {
    "d": ((0x30, 0x39),),
    "w": ((0x30, 0x39), (0x41, 0x5A), (0x5F, 0x5F), (0x61, 0x7A)),
    "s": (
        (0x09, 0x0D),
        (0x20, 0x20),
        (0xA0, 0xA0),
        (0x1680, 0x1680),
        (0x2000, 0x200A),
        (0x2028, 0x2029),
        (0x202F, 0x202F),
        (0x205F, 0x205F),
        (0x3000, 0x3000),
        (0xFEFF, 0xFEFF),
    ),
}
_JS_DOT_EXCLUDED = ((0x0A, 0x0A), (0x0D, 0x0D), (0x2028, 0x2029))
_REJECTED_ESCAPES = frozenset("pP")


def _escape_code_point(code_point: int) -> str:
    if code_point > 0xFFFF:
        return f"\\U{code_point:08X}"
    return f"\\u{code_point:04X}"


def _render_ranges(ranges: Sequence[tuple[int, int]]) -> str:
    return "".join(
        _escape_code_point(low)
        if low == high
        else f"{_escape_code_point(low)}-{_escape_code_point(high)}"
        for low, high in ranges
    )


def _complement_ranges(
    ranges: Sequence[tuple[int, int]],
) -> tuple[tuple[int, int], ...]:
    complement: list[tuple[int, int]] = []
    cursor = 0
    for low, high in sorted(ranges):
        if low > cursor:
            complement.append((cursor, low - 1))
        cursor = max(cursor, high + 1)
    if cursor <= _MAX_CODE_POINT:
        complement.append((cursor, _MAX_CODE_POINT))
    return tuple(complement)


def _shorthand_class_content(escape: str) -> str:
    """Renders \\d, \\D, \\w, \\W, \\s, or \\S as explicit class members."""
    ranges = _JS_SHORTHAND_RANGES[escape.lower()]
    return _render_ranges(_complement_ranges(ranges) if escape.isupper() else ranges)


_JS_DOT = f"[{_render_ranges(_complement_ranges(_JS_DOT_EXCLUDED))}]"


def _translate_ecmascript_pattern(pattern: str) -> str:
    """Rewrites the constructs where Python's regex dialect differs from JS.

    Only the divergent constructs are rewritten; groups, quantifiers, classes,
    and ordinary escapes are copied through because both dialects agree on them.
    Constructs whose meaning differs and cannot be expressed faithfully are
    rejected rather than approximated.
    """
    result: list[str] = []
    index = 0
    in_class = False
    length = len(pattern)
    while index < length:
        character = pattern[index]
        if character == "\\":
            if index + 1 >= length:
                raise LearningContractValidatorError(
                    "Pattern ends with a dangling escape"
                )
            escape = pattern[index + 1]
            if escape in _REJECTED_ESCAPES:
                raise LearningContractValidatorError(
                    f"Unsupported ECMAScript escape \\{escape} in pattern"
                )
            if escape.lower() in _JS_SHORTHAND_RANGES:
                content = _shorthand_class_content(escape)
                result.append(content if in_class else f"[{content}]")
            else:
                result.append(character + escape)
            index += 2
            continue
        if in_class:
            if character == "]":
                in_class = False
            result.append(character)
            index += 1
            continue
        if character == "[":
            in_class = True
            result.append(character)
            index += 1
            if index < length and pattern[index] == "^":
                result.append("^")
                index += 1
            if index < length and pattern[index] == "]":
                result.append("\\]")
                index += 1
            continue
        if character == "^":
            result.append("\\A")
        elif character == "$":
            result.append("\\Z")
        elif character == ".":
            result.append(_JS_DOT)
        elif character == "(" and pattern.startswith("(?<", index):
            if not pattern.startswith("(?<=", index) and not pattern.startswith(
                "(?<!", index
            ):
                raise LearningContractValidatorError(
                    "Named capture groups are not supported in patterns"
                )
            result.append(character)
        else:
            result.append(character)
        index += 1
    if in_class:
        raise LearningContractValidatorError("Pattern has an unterminated class")
    return "".join(result)


_PATTERN_CACHE: dict[str, re.Pattern[str]] = {}


def _compile_pattern(pattern: str) -> re.Pattern[str]:
    compiled = _PATTERN_CACHE.get(pattern)
    if compiled is None:
        try:
            compiled = re.compile(_translate_ecmascript_pattern(pattern))
        except re.error as error:
            raise LearningContractValidatorError(
                f"Unsupported pattern {pattern!r}: {error}"
            ) from error
        _PATTERN_CACHE[pattern] = compiled
    return compiled


# --------------------------------------------------------------------------- #
# JSON pointer selection                                                      #
# --------------------------------------------------------------------------- #

_ARRAY_INDEX = re.compile(r"\A(?:0|[1-9][0-9]*)\Z")


def _decode_pointer_segment(segment: str) -> str:
    # Deliberately mirrors the TypeScript peer's replacement order.
    return segment.replace("~1", "/").replace("~0", "~")


def _select_pointer_values(root: Any, pointer: str) -> list[Any]:
    if pointer == "":
        return [root]
    if not pointer.startswith("/"):
        return []
    values: list[Any] = [root]
    for segment in (_decode_pointer_segment(part) for part in pointer[1:].split("/")):
        next_values: list[Any] = []
        for value in values:
            if segment == "*":
                if _is_array(value):
                    next_values.extend(value)
                elif _is_object(value):
                    next_values.extend(value.values())
                continue
            if _is_array(value) and _ARRAY_INDEX.match(segment):
                position = int(segment)
                if position < len(value):
                    next_values.append(value[position])
            elif _is_object(value) and segment in value:
                next_values.append(value[segment])
        values = next_values
    return values


# --------------------------------------------------------------------------- #
# Assertion value normalization and comparison                                #
# --------------------------------------------------------------------------- #


def _normalize_assertion_value(
    value: Any, normalization: Mapping[str, Any] | None
) -> Any:
    if not isinstance(value, str) or normalization is None:
        return value
    unicode_form = normalization.get("unicode")
    normalized = unicodedata.normalize(unicode_form, value) if unicode_form else value
    return (
        unicode_default_case_fold(normalized)
        if normalization.get("caseFold")
        else normalized
    )


def _assertion_value_key(
    value: Any, normalization: Mapping[str, Any] | None = None
) -> str:
    normalized = _normalize_assertion_value(value, normalization)
    return f"{_js_typeof(normalized)}:{_js_json(normalized)}"


_CANONICAL_DATE_TIME = re.compile(
    r"\A([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})"
    r"(?::([0-9]{2})(?:\.([0-9]+))?)?(Z|([+-])([0-9]{2}):([0-9]{2}))\Z"
)
_MONTH_DAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _days_from_civil(year: int, month: int, day: int) -> int:
    shifted = year - (1 if month <= 2 else 0)
    era = (shifted if shifted >= 0 else shifted - 399) // 400
    year_of_era = shifted - era * 400
    day_of_year = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    return era * 146097 + day_of_era - 719468


def _parse_canonical_date_time(value: str) -> tuple[int, str] | None:
    match = _CANONICAL_DATE_TIME.match(value)
    if match is None:
        return None
    year, month, day = int(match[1]), int(match[2]), int(match[3])
    hour, minute = int(match[4]), int(match[5])
    second = int(match[6] or "0")
    offset_hour = int(match[10] or "0")
    offset_minute = int(match[11] or "0")
    if offset_hour > 23 or offset_minute > 59:
        return None
    if not 1 <= month <= 12 or hour > 23 or minute > 59 or second > 59 or day < 1:
        return None
    leap = month == 2 and (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0))
    if day > _MONTH_DAYS[month - 1] + (1 if leap else 0):
        return None
    direction = -1 if match[9] == "-" else 1
    offset_seconds = (
        0 if match[8] == "Z" else direction * (offset_hour * 3600 + offset_minute * 60)
    )
    epoch_second = (
        _days_from_civil(year, month, day) * 86400
        + hour * 3600
        + minute * 60
        + second
        - offset_seconds
    )
    return epoch_second, match[7] or ""


def _compare_fractional_seconds(left: str, right: str) -> int:
    precision = max(len(left), len(right))
    padded_left = left.ljust(precision, "0")
    padded_right = right.ljust(precision, "0")
    if padded_left < padded_right:
        return -1
    return 1 if padded_left > padded_right else 0


def _compare_canonical_date_times(left: str, right: str) -> int | None:
    left_instant = _parse_canonical_date_time(left)
    right_instant = _parse_canonical_date_time(right)
    if left_instant is None or right_instant is None:
        return None
    if left_instant[0] != right_instant[0]:
        return -1 if left_instant[0] < right_instant[0] else 1
    return _compare_fractional_seconds(left_instant[1], right_instant[1])


class _DateTime:
    """Marks a value as compared on the canonical date-time timeline."""

    __slots__ = ("value",)

    def __init__(self, value: str) -> None:
        self.value = value


def _comparable_value(value: Any, value_type: str | None) -> Any:
    if value_type == "number":
        return value if _is_number(value) else _MISSING
    if value_type == "date-time":
        if not isinstance(value, str):
            return _MISSING
        return (
            _MISSING
            if _compare_canonical_date_times(value, value) is None
            else _DateTime(value)
        )
    if value_type == "string":
        return value if isinstance(value, str) else _MISSING
    if _is_number(value) or isinstance(value, str):
        return value
    return _MISSING


def _compare_comparable(left: Any, right: Any) -> int | None:
    if isinstance(left, _DateTime) and isinstance(right, _DateTime):
        return _compare_canonical_date_times(left.value, right.value)
    if isinstance(left, _DateTime) or isinstance(right, _DateTime):
        return None
    if _is_number(left) != _is_number(right):
        return None
    if left < right:
        return -1
    return 1 if left > right else 0


def _compare_assertion_values(
    left: Any,
    right: Any,
    relation: str,
    value_type: str | None = None,
    normalization: Mapping[str, Any] | None = None,
) -> bool:
    if relation == "equal":
        if value_type == "date-time" and (
            _comparable_value(left, value_type) is _MISSING
            or _comparable_value(right, value_type) is _MISSING
        ):
            return False
        return _assertion_value_key(left, normalization) == _assertion_value_key(
            right, normalization
        )
    comparable_left = _comparable_value(left, value_type)
    comparable_right = _comparable_value(right, value_type)
    if comparable_left is _MISSING or comparable_right is _MISSING:
        return False
    comparison = _compare_comparable(comparable_left, comparable_right)
    if comparison is None:
        return False
    return comparison < 0 if relation == "less-than" else comparison <= 0


def _exactly_one(values: Sequence[Any]) -> bool:
    return len(values) == 1


# --------------------------------------------------------------------------- #
# Bounded JSON trees and the inline-payload key vocabulary                    #
# --------------------------------------------------------------------------- #


def normalize_inline_attachment_payload_key_v1(key: str) -> str:
    """NFKC, lowercase, then drop white space and dash/connector punctuation."""
    lowered = unicodedata.normalize("NFKC", key).lower()
    return "".join(
        character
        for character in lowered
        if ord(character) not in _WHITE_SPACE_CODE_POINTS
        and unicodedata.category(character) not in ("Pd", "Pc")
    )


class _BoundsExceeded(Exception):
    pass


def _validate_json_tree_bounds(value: Any, bounds: Mapping[str, int]) -> bool:
    """Returns whether ``value`` satisfies every V1 JSON tree bound.

    The TypeScript peer collects issues and stops descending into containers
    once the node or depth cap is hit. Because the only question asked here is
    whether the issue list is empty, an early return on the first violation is
    exactly equivalent: any path that would have triggered the descent cap has
    already produced an issue.
    """
    state = {"nodes": 0, "serialized": 0}

    def visit(current: Any, depth: int) -> None:
        state["nodes"] += 1
        if state["nodes"] > bounds["maxNodes"] or depth > bounds["maxDepth"]:
            raise _BoundsExceeded
        if isinstance(current, str):
            if utf8_byte_length(current) > bounds["maxStringBytes"]:
                raise _BoundsExceeded
            state["serialized"] += _json_string_byte_length(current)
            return
        if current is None:
            state["serialized"] += 4
            return
        if isinstance(current, bool):
            state["serialized"] += 4 if current else 5
            return
        if _is_number(current):
            state["serialized"] += len(_js_number(current))
            return
        if _is_array(current):
            if len(current) > bounds["maxArrayItems"]:
                raise _BoundsExceeded
            state["serialized"] += 2 + max(0, len(current) - 1)
            for item in current:
                visit(item, depth + 1)
            return
        if _is_object(current):
            keys = list(current)
            if len(keys) > bounds["maxObjectProperties"]:
                raise _BoundsExceeded
            state["serialized"] += 2 + max(0, len(keys) - 1) + len(keys)
            for key in keys:
                # JSON.parse materializes "__proto__" as an own property, which
                # the TypeScript peer reports as invalid JSON.
                if key == "__proto__":
                    raise _BoundsExceeded
                if utf8_byte_length(key) > bounds["maxKeyBytes"]:
                    raise _BoundsExceeded
                state["serialized"] += _json_string_byte_length(key)
                visit(current[key], depth + 1)
            return
        raise _BoundsExceeded

    try:
        visit(value, 1)
    except _BoundsExceeded:
        return False
    except RecursionError:
        return False
    return state["serialized"] <= bounds["maxSerializedBytes"]


def _has_forbidden_bounded_json_key(value: Any, assertion: Mapping[str, Any]) -> bool:
    if _is_array(value):
        return any(_has_forbidden_bounded_json_key(item, assertion) for item in value)
    if not _is_object(value):
        return False
    forbidden: Iterable[str] = assertion.get("forbiddenNormalizedKeys") or ()
    suffixes: Iterable[str] = assertion.get("forbiddenNormalizedKeySuffixes") or ()
    fragments: Iterable[str] = assertion.get("forbiddenNormalizedKeyFragments") or ()
    for key, item in value.items():
        normalized = normalize_inline_attachment_payload_key_v1(key)
        if (
            normalized in tuple(forbidden)
            or any(normalized.endswith(suffix) for suffix in suffixes)
            or any(fragment in normalized for fragment in fragments)
            or _has_forbidden_bounded_json_key(item, assertion)
        ):
            return True
    return False


# --------------------------------------------------------------------------- #
# Assertion operations                                                        #
# --------------------------------------------------------------------------- #


def _op_compare(assertion: Mapping[str, Any], data: Any) -> bool:
    left = _select_pointer_values(data, assertion["left"])
    right = _select_pointer_values(data, assertion["right"])
    return (
        _exactly_one(left)
        and _exactly_one(right)
        and _compare_assertion_values(
            left[0],
            right[0],
            assertion["relation"],
            assertion.get("valueType"),
            assertion.get("normalization"),
        )
    )


def _op_compare_values(assertion: Mapping[str, Any], data: Any) -> bool:
    right = _select_pointer_values(data, assertion["right"])
    return _exactly_one(right) and all(
        _compare_assertion_values(
            value, right[0], assertion["relation"], assertion["valueType"]
        )
        for value in _select_pointer_values(data, assertion["values"])
    )


def _op_unique(assertion: Mapping[str, Any], data: Any) -> bool:
    keys = [
        _assertion_value_key(value, assertion.get("normalization"))
        for value in _select_pointer_values(data, assertion["values"])
    ]
    return len(set(keys)) == len(keys)


def _op_all_equal(assertion: Mapping[str, Any], data: Any) -> bool:
    keys = {
        _assertion_value_key(value, assertion.get("normalization"))
        for value in _select_pointer_values(data, assertion["values"])
    }
    return len(keys) <= 1


def _op_strictly_increasing(assertion: Mapping[str, Any], data: Any) -> bool:
    values = [
        _comparable_value(value, assertion["valueType"])
        for value in _select_pointer_values(data, assertion["values"])
    ]
    for index, value in enumerate(values):
        if value is _MISSING:
            return False
        if index > 0 and (
            values[index - 1] is _MISSING
            or _compare_comparable(value, values[index - 1]) != 1
        ):
            return False
    return True


def _op_contiguous(assertion: Mapping[str, Any], data: Any) -> bool:
    return all(
        _json_equal(value, assertion["start"] + index)
        for index, value in enumerate(_select_pointer_values(data, assertion["values"]))
    )


def _op_values_in_range(assertion: Mapping[str, Any], data: Any) -> bool:
    minimum_values = _select_pointer_values(data, assertion["minimum"])
    maximum_values = _select_pointer_values(data, assertion["maximum"])
    if not _exactly_one(minimum_values) or not _exactly_one(maximum_values):
        return False
    minimum = _comparable_value(minimum_values[0], assertion["valueType"])
    maximum = _comparable_value(maximum_values[0], assertion["valueType"])
    if minimum is _MISSING or maximum is _MISSING:
        return False
    bounds_comparison = _compare_comparable(minimum, maximum)
    if bounds_comparison is None or bounds_comparison > 0:
        return False
    for value in _select_pointer_values(data, assertion["values"]):
        comparable = _comparable_value(value, assertion["valueType"])
        if comparable is _MISSING:
            return False
        low = _compare_comparable(comparable, minimum)
        high = _compare_comparable(comparable, maximum)
        if low is None or high is None:
            return False
        above = low > 0 if assertion.get("minimumExclusive") else low >= 0
        below = high < 0 if assertion.get("maximumExclusive") else high <= 0
        if not (above and below):
            return False
    return True


def _op_references(assertion: Mapping[str, Any], data: Any) -> bool:
    normalization = assertion.get("normalization")
    targets = {
        _assertion_value_key(value, normalization)
        for value in _select_pointer_values(data, assertion["targets"])
    }
    return all(
        _assertion_value_key(value, normalization) in targets
        for value in _select_pointer_values(data, assertion["values"])
    )


def _op_disjoint(assertion: Mapping[str, Any], data: Any) -> bool:
    normalization = assertion.get("normalization")
    right = {
        _assertion_value_key(value, normalization)
        for value in _select_pointer_values(data, assertion["right"])
    }
    return all(
        _assertion_value_key(value, normalization) not in right
        for value in _select_pointer_values(data, assertion["left"])
    )


def _op_ordered_ranges(assertion: Mapping[str, Any], data: Any) -> bool:
    previous_last: Any = _MISSING
    for entry in _select_pointer_values(data, assertion["ranges"]):
        first_values = _select_pointer_values(entry, assertion["first"])
        last_values = _select_pointer_values(entry, assertion["last"])
        if not _exactly_one(first_values) or not _exactly_one(last_values):
            return False
        first = _comparable_value(first_values[0], assertion["valueType"])
        last = _comparable_value(last_values[0], assertion["valueType"])
        if first is _MISSING or last is _MISSING:
            return False
        range_comparison = _compare_comparable(first, last)
        if range_comparison is None or range_comparison > 0:
            return False
        if previous_last is not _MISSING:
            previous_comparison = _compare_comparable(first, previous_last)
            if previous_comparison is None or previous_comparison <= 0:
                return False
        previous_last = last
    return True


def _op_lookup_equal(assertion: Mapping[str, Any], data: Any) -> bool:
    normalization = assertion.get("normalization")
    references = _select_pointer_values(data, assertion["reference"])
    expected = _select_pointer_values(data, assertion["expected"])
    if not _exactly_one(references) or not _exactly_one(expected):
        return False
    reference_key = _assertion_value_key(references[0], normalization)
    matches = [
        entry
        for entry in _select_pointer_values(data, assertion["collection"])
        if _matches_lookup_key(entry, assertion["key"], normalization, reference_key)
    ]
    if not _exactly_one(matches):
        return False
    values = _select_pointer_values(matches[0], assertion["value"])
    return _exactly_one(values) and _compare_assertion_values(
        values[0], expected[0], "equal", None, normalization
    )


def _matches_lookup_key(
    entry: Any,
    key_pointer: str,
    normalization: Mapping[str, Any] | None,
    reference_key: str,
) -> bool:
    keys = _select_pointer_values(entry, key_pointer)
    return (
        _exactly_one(keys)
        and _assertion_value_key(keys[0], normalization) == reference_key
    )


def _op_lookup_references(assertion: Mapping[str, Any], data: Any) -> bool:
    key_normalization = assertion.get("keyNormalization")
    value_normalization = assertion.get("valueNormalization")
    collection = _select_pointer_values(data, assertion["collection"])
    target_pointers = assertion["targets"]
    if isinstance(target_pointers, str):
        target_pointers = [target_pointers]
    for source in _select_pointer_values(data, assertion["sources"]):
        references = _select_pointer_values(source, assertion["reference"])
        if not _exactly_one(references):
            return False
        reference_key = _assertion_value_key(references[0], key_normalization)
        matches = [
            entry
            for entry in collection
            if _matches_lookup_key(
                entry, assertion["key"], key_normalization, reference_key
            )
        ]
        if not _exactly_one(matches):
            return False
        targets = {
            _assertion_value_key(value, value_normalization)
            for pointer in target_pointers
            for value in _select_pointer_values(matches[0], pointer)
        }
        for value in _select_pointer_values(source, assertion["values"]):
            if _assertion_value_key(value, value_normalization) not in targets:
                return False
    return True


def _op_count(assertion: Mapping[str, Any], data: Any) -> bool:
    normalization = assertion.get("normalization")
    where = assertion.get("where")

    def matches(value: Any) -> bool:
        if where is None:
            return True
        key = _assertion_value_key(value, normalization)
        if "equals" in where:
            return key == _assertion_value_key(where["equals"], normalization)
        return any(
            key == _assertion_value_key(candidate, normalization)
            for candidate in where["in"]
        )

    count = sum(
        1
        for value in _select_pointer_values(data, assertion["values"])
        if matches(value)
    )
    if "exactly" in assertion and count != assertion["exactly"]:
        return False
    if "minimum" in assertion and count < assertion["minimum"]:
        return False
    return "maximum" not in assertion or count <= assertion["maximum"]


def _op_utf8_byte_length(assertion: Mapping[str, Any], data: Any) -> bool:
    return all(
        value is None
        or (isinstance(value, str) and utf8_byte_length(value) <= assertion["maximum"])
        for value in _select_pointer_values(data, assertion["values"])
    )


def _op_bounded_json(assertion: Mapping[str, Any], data: Any) -> bool:
    bounds = {
        "maxSerializedBytes": assertion["serializedMaximum"],
        "maxDepth": assertion["maximumDepth"],
        "maxNodes": assertion["maximumNodes"],
        "maxObjectProperties": assertion["maximumObjectProperties"],
        "maxArrayItems": assertion["maximumArrayItems"],
        "maxStringBytes": assertion["maximumStringUtf8Bytes"],
        "maxKeyBytes": assertion["maximumKeyUtf8Bytes"],
    }
    for value in _select_pointer_values(data, assertion["values"]):
        if value is None:
            continue
        if not _is_object(value):
            return False
        if not _validate_json_tree_bounds(
            value, bounds
        ) or _has_forbidden_bounded_json_key(value, assertion):
            return False
    return True


_OPERATIONS: Mapping[str, Callable[[Mapping[str, Any], Any], bool]] = {
    "compare": _op_compare,
    "compare-values": _op_compare_values,
    "unique": _op_unique,
    "all-equal": _op_all_equal,
    "strictly-increasing": _op_strictly_increasing,
    "contiguous": _op_contiguous,
    "values-in-range": _op_values_in_range,
    "references": _op_references,
    "disjoint": _op_disjoint,
    "ordered-ranges": _op_ordered_ranges,
    "lookup-equal": _op_lookup_equal,
    "lookup-references": _op_lookup_references,
    "count": _op_count,
    "utf8-byte-length": _op_utf8_byte_length,
    "bounded-json": _op_bounded_json,
}


def _validate_assertions(assertions: Any, value: Any) -> bool:
    if not _is_array(assertions) or not _is_object(value):
        return False
    for assertion in assertions:
        if not _is_object(assertion):
            return False
        operation = _OPERATIONS.get(assertion.get("operation"))
        if operation is None:
            raise LearningContractValidatorError(
                f"Unsupported assertion operation: {assertion.get('operation')!r}"
            )
        if not operation(assertion, value):
            return False
    return True


def _validate_equal_properties(pairs: Any, value: Any) -> bool:
    if not _is_array(pairs) or not _is_object(value):
        return False
    for pair in pairs:
        if not _is_array(pair) or len(pair) != 2:
            return False
        left = value.get(pair[0], _MISSING)
        right = value.get(pair[1], _MISSING)
        if left is _MISSING or right is _MISSING:
            # JavaScript compares two absent properties as undefined === undefined.
            if left is not right:
                return False
            continue
        if _is_object(left) or _is_array(left) or _is_object(right) or _is_array(right):
            # Strict equality on containers is reference identity, which parsed
            # JSON can only satisfy for the very same node.
            if left is not right:
                return False
            continue
        if not _json_equal(left, right):
            return False
    return True


# --------------------------------------------------------------------------- #
# Draft 2020-12 subset                                                        #
# --------------------------------------------------------------------------- #

_IGNORED_KEYWORDS = frozenset(
    {
        "$comment",
        "$defs",
        "$schema",
        "default",
        "deprecated",
        "description",
        "examples",
        "readOnly",
        "title",
        "writeOnly",
        # Ajv is configured with validateFormats: false, so "format" is a pure
        # annotation in the reference validator and must stay one here.
        "format",
    }
)

_JSON_TYPES = frozenset(
    {"array", "boolean", "integer", "null", "number", "object", "string"}
)


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "null":
        return value is None
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "object":
        return _is_object(value)
    if expected == "array":
        return _is_array(value)
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return _is_number(value)
    if expected == "integer":
        return _is_number(value) and float(value).is_integer()
    raise LearningContractValidatorError(f"Unsupported JSON type: {expected!r}")


class _Validator:
    def __init__(self, root: Any) -> None:
        self._root = root

    def validate(self, schema: Any, value: Any) -> bool:
        if isinstance(schema, bool):
            return schema
        if not _is_object(schema):
            raise LearningContractValidatorError(
                f"Schema must be an object or boolean: {schema!r}"
            )
        for keyword, subschema in schema.items():
            if keyword in _IGNORED_KEYWORDS:
                continue
            if not self._apply(keyword, subschema, value, schema):
                return False
        return True

    def _apply(self, keyword: str, subschema: Any, value: Any, schema: Any) -> bool:
        if keyword == "$ref":
            return self.validate(self._resolve(subschema), value)
        if keyword == "type":
            expected = [subschema] if isinstance(subschema, str) else subschema
            for candidate in expected:
                if candidate not in _JSON_TYPES:
                    raise LearningContractValidatorError(
                        f"Unsupported JSON type: {candidate!r}"
                    )
            return any(_matches_type(value, candidate) for candidate in expected)
        if keyword == "const":
            return _json_equal(value, subschema)
        if keyword == "enum":
            return any(_json_equal(value, candidate) for candidate in subschema)
        if keyword == "allOf":
            return all(self.validate(entry, value) for entry in subschema)
        if keyword == "anyOf":
            return any(self.validate(entry, value) for entry in subschema)
        if keyword == "oneOf":
            return sum(1 for entry in subschema if self.validate(entry, value)) == 1
        if keyword == "not":
            return not self.validate(subschema, value)
        if keyword == "if":
            if self.validate(subschema, value):
                return "then" not in schema or self.validate(schema["then"], value)
            return "else" not in schema or self.validate(schema["else"], value)
        if keyword in ("then", "else"):
            # Applied by "if"; inert on their own, exactly as in Draft 2020-12.
            return True
        if keyword == "pattern":
            return not isinstance(value, str) or bool(
                _compile_pattern(subschema).search(value)
            )
        if keyword == "minLength":
            return not isinstance(value, str) or len(value) >= subschema
        if keyword == "maxLength":
            return not isinstance(value, str) or len(value) <= subschema
        if keyword == "minimum":
            return not _is_number(value) or value >= subschema
        if keyword == "maximum":
            return not _is_number(value) or value <= subschema
        if keyword == "exclusiveMinimum":
            return not _is_number(value) or value > subschema
        if keyword == "exclusiveMaximum":
            return not _is_number(value) or value < subschema
        if keyword == "multipleOf":
            return not _is_number(value) or (value / subschema).is_integer()
        if keyword == "minItems":
            return not _is_array(value) or len(value) >= subschema
        if keyword == "maxItems":
            return not _is_array(value) or len(value) <= subschema
        if keyword == "uniqueItems":
            if not subschema or not _is_array(value):
                return True
            keys = [_js_typeof(item) + ":" + _js_json(item) for item in value]
            return len(set(keys)) == len(keys)
        if keyword == "items":
            return not _is_array(value) or all(
                self.validate(subschema, item) for item in value
            )
        if keyword == "minProperties":
            return not _is_object(value) or len(value) >= subschema
        if keyword == "maxProperties":
            return not _is_object(value) or len(value) <= subschema
        if keyword == "required":
            return not _is_object(value) or all(name in value for name in subschema)
        if keyword == "properties":
            return not _is_object(value) or all(
                self.validate(child, value[name])
                for name, child in subschema.items()
                if name in value
            )
        if keyword == "additionalProperties":
            if not _is_object(value):
                return True
            declared = schema.get("properties") or {}
            return all(
                self.validate(subschema, item)
                for name, item in value.items()
                if name not in declared
            )
        if keyword == "propertyNames":
            return not _is_object(value) or all(
                self.validate(subschema, name) for name in value
            )
        if keyword == COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD:
            # Ajv registers this with type: "object", so non-objects skip it.
            return not _is_object(value) or _validate_equal_properties(subschema, value)
        if keyword == COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD:
            return not _is_object(value) or _validate_assertions(subschema, value)
        raise LearningContractValidatorError(
            f"Unsupported JSON Schema keyword: {keyword!r}"
        )

    def _resolve(self, reference: Any) -> Any:
        if not isinstance(reference, str) or not reference.startswith("#/"):
            raise LearningContractValidatorError(
                f"Only local JSON pointer $ref is supported: {reference!r}"
            )
        target: Any = self._root
        for segment in reference[2:].split("/"):
            decoded = _decode_pointer_segment(segment)
            if not _is_object(target) or decoded not in target:
                raise LearningContractValidatorError(
                    f"Unresolvable $ref: {reference!r}"
                )
            target = target[decoded]
        return target


def compile_learning_contract_schema(schema: Any) -> Callable[[Any], bool]:
    """Returns a reusable predicate for one Learning Contract V1 JSON Schema."""
    validator = _Validator(schema)
    return lambda value: validator.validate(schema, value)


def validate_learning_contract(schema: Any, value: Any) -> bool:
    """Validates one value against one Learning Contract V1 JSON Schema."""
    return compile_learning_contract_schema(schema)(value)
