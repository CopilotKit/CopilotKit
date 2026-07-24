"""Runs the language-neutral conformance corpus through the Python validator.

Before this suite existed the corpus was only read to extract the canonical
error-code enums, which left every declarative assertion — path and Unicode
collisions, subject-hash equality, ordering, bounded JSON trees, and the
inline-payload key vocabulary — unenforced in Python.
"""

import json
from pathlib import Path

import pytest

from copilotkit.learning_contract_validator import (
    COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
    COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
    LearningContractValidatorError,
    compile_learning_contract_schema,
    normalize_inline_attachment_payload_key_v1,
    utf8_byte_length,
)
from copilotkit.unicode_default_case_folding import (
    unicode_default_case_fold,
    unicode_default_case_fold_normalized,
)

CORPUS_PATH = (
    Path(__file__).parents[2]
    / "packages/intelligence/conformance/learning-platform-v1.json"
)


def corpus():
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def without_custom_keywords(node):
    if isinstance(node, dict):
        return {
            key: without_custom_keywords(value)
            for key, value in node.items()
            if key
            not in (
                COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD,
                COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD,
            )
        }
    if isinstance(node, list):
        return [without_custom_keywords(value) for value in node]
    return node


def test_every_corpus_case_matches_its_declared_validity():
    published = corpus()
    validators = {}
    mismatches = []

    for case in published["cases"]:
        schema_name = case["schema"]
        if schema_name not in validators:
            validators[schema_name] = compile_learning_contract_schema(
                published["schemas"][schema_name]
            )
        actual = validators[schema_name](case["value"])
        if actual != case["valid"]:
            mismatches.append(
                f"{case['name']} [{schema_name}]: got {actual} expected {case['valid']}"
            )

    assert len(published["cases"]) == 315
    assert len(published["schemas"]) == 47
    assert mismatches == []


def test_the_custom_keywords_are_what_rejects_the_assertion_only_negative_cases():
    """Guards against the validator degrading into a plain Draft 2020-12 checker."""
    published = corpus()
    validators = {
        name: compile_learning_contract_schema(without_custom_keywords(schema))
        for name, schema in published["schemas"].items()
    }

    accepted = [
        case["name"]
        for case in published["cases"]
        if not case["valid"] and validators[case["schema"]](case["value"])
    ]

    assert len(accepted) == 112


def test_every_corpus_assertion_operation_decides_at_least_one_case():
    """A ported operation that decides nothing would be dead, unverified code."""
    published = corpus()
    operations = set()

    def collect(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key == COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD:
                    operations.update(entry["operation"] for entry in value)
                collect(value)
        elif isinstance(node, list):
            for value in node:
                collect(value)

    collect(published["schemas"])

    def without_operation(node, operation):
        if isinstance(node, dict):
            return {
                key: (
                    [entry for entry in value if entry["operation"] != operation]
                    if key == COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD
                    else without_operation(value, operation)
                )
                for key, value in node.items()
            }
        if isinstance(node, list):
            return [without_operation(value, operation) for value in node]
        return node

    undecided = []
    for operation in sorted(operations):
        validators = {
            name: compile_learning_contract_schema(without_operation(schema, operation))
            for name, schema in published["schemas"].items()
        }
        decided = [
            case["name"]
            for case in published["cases"]
            if validators[case["schema"]](case["value"]) != case["valid"]
        ]
        if not decided:
            undecided.append(operation)

    assert operations
    assert undecided == []


def test_unknown_schema_keywords_fail_loudly_instead_of_being_ignored():
    validate = compile_learning_contract_schema(
        {"type": "object", "x-future-copilotkit-keyword": True}
    )

    with pytest.raises(
        LearningContractValidatorError, match="x-future-copilotkit-keyword"
    ):
        validate({})


def test_unknown_assertion_operations_fail_loudly_instead_of_being_ignored():
    validate = compile_learning_contract_schema(
        {
            "type": "object",
            COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD: [
                {"operation": "future-operation", "values": "/a"}
            ],
        }
    )

    with pytest.raises(LearningContractValidatorError, match="future-operation"):
        validate({"a": 1})


@pytest.mark.parametrize(
    ("pattern", "candidate", "expected"),
    [
        ("^[a-f0-9]{4}$", "abcd", True),
        # Python's "$" also matches before a trailing newline; JavaScript's does not.
        ("^[a-f0-9]{4}$", "abcd\n", False),
        (r"^\d+$", "123", True),
        # Python's "\d" matches Unicode digits; JavaScript's does not.
        (r"^\d+$", "١٢٣", False),
        (r"^a[\s\S]*z$", "az", True),
        (r"^a[\s\S]*z$", "a\nz", True),
    ],
)
def test_ecmascript_patterns_keep_javascript_semantics(pattern, candidate, expected):
    validate = compile_learning_contract_schema({"type": "string", "pattern": pattern})

    assert validate(candidate) is expected


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("body", "body"),
        ("BODY", "body"),
        ("ｂｏｄｙ", "body"),
        ("in-line_body", "inlinebody"),
        ("in line body", "inlinebody"),
        ("Base‐64", "base64"),
    ],
)
def test_inline_payload_key_normalization_is_unicode_aware(key, expected):
    assert normalize_inline_attachment_payload_key_v1(key) == expected


def test_utf8_byte_length_counts_astral_characters_as_four_bytes():
    assert utf8_byte_length("a") == 1
    assert utf8_byte_length("é") == 2
    assert utf8_byte_length("€") == 3
    assert utf8_byte_length("\U0001f600") == 4


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("Straße.txt", "STRASSE.txt"),
        ("İ.txt", "i̇.txt"),
        ("ﬁle.md", "file.md"),
        ("SKILL.md", "skill.md"),
    ],
)
def test_pinned_folding_collapses_the_corpus_collision_pairs(left, right):
    assert unicode_default_case_fold_normalized(
        left
    ) == unicode_default_case_fold_normalized(right)


def test_pinned_folding_keeps_the_turkic_dotless_i_distinct():
    assert unicode_default_case_fold("ı") == "ı"
    assert unicode_default_case_fold("I") == "i"
    assert unicode_default_case_fold("ı") != unicode_default_case_fold("I")
