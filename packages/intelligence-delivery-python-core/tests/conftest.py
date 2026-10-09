import base64
import json
from pathlib import Path

import pytest

FIXTURES = json.loads((Path(__file__).parents[1] / "conformance/snapshots.v1.json").read_text())
LIFECYCLE = json.loads((Path(__file__).parents[1] / "conformance/lifecycle.v1.json").read_text())


def response(name="text-skill"):
    item = next(item for item in FIXTURES["cases"] if item["name"] == name)
    return {
        "status": "snapshot",
        "bytes": base64.b64decode(item["archiveBase64"]),
        "revision": item["revision"],
        "etag": item["etag"],
        "contentType": "application/zip",
    }


@pytest.fixture(autouse=True)
def clear_environment(monkeypatch):
    for name in (
        "CPK_INTELLIGENCE_API_KEY",
        "INTELLIGENCE_API_URL",
        "CPK_INTELLIGENCE_LEARNING_CONTAINER_ID",
        "CPK_INTELLIGENCE_SKILLS_REVISION",
    ):
        monkeypatch.delenv(name, raising=False)
