# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


from a2a.server.agent_execution import RequestContext
from a2a.types import DataPart, TextPart, Part
from a2ui import a2ui_extension

from unittest.mock import MagicMock


def test_a2ui_part_serialization():
    a2ui_data = {"beginRendering": {"surfaceId": "test-surface", "root": "root-column"}}

    part = a2ui_extension.create_a2ui_part(a2ui_data)

    assert a2ui_extension.is_a2ui_part(part), "Should be identified as A2UI part"

    data_part = a2ui_extension.get_a2ui_datapart(part)
    assert data_part is not None, "Should contain DataPart"
    assert a2ui_data == data_part.data, "Deserialized data should match original"


def test_non_a2ui_data_part():
    part = Part(
        root=DataPart(
            data={"foo": "bar"}, metadata={"mimeType": "application/json"}  # Not A2UI
        )
    )
    assert not a2ui_extension.is_a2ui_part(
        part
    ), "Should not be identified as A2UI part"
    assert (
        a2ui_extension.get_a2ui_datapart(part) is None
    ), "Should not return A2UI DataPart"


def test_non_a2ui_part():
    text_part = TextPart(text="this is some text")
    part = Part(root=text_part)

    assert not a2ui_extension.is_a2ui_part(
        part
    ), "Should not be identified as A2UI part"
    assert (
        a2ui_extension.get_a2ui_datapart(part) is None
    ), "Should not return A2UI DataPart"


def test_get_a2ui_agent_extension():
    agent_extension = a2ui_extension.get_a2ui_agent_extension()
    assert agent_extension.uri == a2ui_extension.A2UI_EXTENSION_URI
    assert agent_extension.params is None


def test_get_a2ui_agent_extension_with_inline_custom_catalog():
    agent_extension = a2ui_extension.get_a2ui_agent_extension(
        accepts_inline_custom_catalog=True
    )
    assert agent_extension.uri == a2ui_extension.A2UI_EXTENSION_URI
    assert agent_extension.params is not None


def test_try_activate_a2ui_extension():
    context = MagicMock(spec=RequestContext)
    context.requested_extensions = [a2ui_extension.A2UI_EXTENSION_URI]

    assert a2ui_extension.try_activate_a2ui_extension(context)
    context.add_activated_extension.assert_called_once_with(
        a2ui_extension.A2UI_EXTENSION_URI
    )


def test_try_activate_a2ui_extension_not_requested():
    context = MagicMock(spec=RequestContext)
    context.requested_extensions = []

    assert not a2ui_extension.try_activate_a2ui_extension(context)
    context.add_activated_extension.assert_not_called()
