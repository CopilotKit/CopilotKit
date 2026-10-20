import dataclasses
import hashlib
import io
import json
import zipfile

import pytest
from conftest import FIXTURES, response
from copilotkit_intelligence import LearnedSkillsError

from _delivery.snapshot import validate_snapshot


@pytest.mark.parametrize("item", FIXTURES["cases"], ids=lambda item: item["name"])
def test_snapshot_conformance(item):
    if item["expected"] == "valid":
        snapshot = validate_snapshot(response(item["name"]))
        assert snapshot.revision == item["revision"]
    else:
        with pytest.raises(LearnedSkillsError) as error:
            validate_snapshot(response(item["name"]))
        assert error.value.code == item["expected"]


def test_snapshot_is_deeply_immutable():
    snapshot = validate_snapshot(response())
    assert isinstance(snapshot.skills, tuple)
    assert isinstance(snapshot.skills[0].files, tuple)
    with pytest.raises(dataclasses.FrozenInstanceError):
        snapshot.skills[0].files[0].text = "changed"


def test_binary_supporting_file_has_no_text():
    snapshot = validate_snapshot(response("binary-resource"))
    assert (
        next(file for file in snapshot.skills[0].files if file.path == "resource.bin").text is None
    )


@pytest.mark.parametrize(
    "value",
    [None, {}, {**response(), "bytes": b"bad"}, {**response(), "contentType": "application/json"}],
)
def test_invalid_response(value):
    with pytest.raises(LearnedSkillsError, match="response metadata") as error:
        validate_snapshot(value)
    assert error.value.code == "INVALID_SNAPSHOT"


def archive(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for name, value in entries:
            zipped.writestr(name, value)
    data = buffer.getvalue()
    return {**response(), "bytes": data, "etag": '"' + hashlib.sha256(data).hexdigest() + '"'}


def test_entry_count_limit():
    value = archive([(f"file-{index}", b"") for index in range(1001)])
    with pytest.raises(LearnedSkillsError):
        validate_snapshot(value)


def test_decoded_size_limit():
    value = archive([("manifest.json", b" " * (32 * 1024 * 1024 + 1))])
    with pytest.raises(LearnedSkillsError):
        validate_snapshot(value)


def test_archive_size_limit():
    with pytest.raises(LearnedSkillsError):
        validate_snapshot({**response(), "bytes": bytes(32 * 1024 * 1024 + 1)})


def test_schema_boolean_is_not_version_one():
    value = archive(
        [("manifest.json", json.dumps({"schemaVersion": True, "revision": "r1", "skills": []}))]
    )
    with pytest.raises(LearnedSkillsError) as error:
        validate_snapshot(value)
    assert error.value.code == "INVALID_SNAPSHOT"


def test_integral_json_file_sizes_match_other_language_parsers():
    original = response()
    with zipfile.ZipFile(io.BytesIO(original["bytes"])) as zipped:
        entries = [(entry.filename, zipped.read(entry)) for entry in zipped.infolist()]
    manifest = json.loads(entries[0][1])
    for skill in manifest["skills"]:
        for file in skill["files"]:
            file["size"] = float(file["size"])
    entries[0] = ("manifest.json", json.dumps(manifest).encode())
    assert validate_snapshot(archive(entries)).revision == "r1"
