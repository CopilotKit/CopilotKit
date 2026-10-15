"""One modern attachment should produce one LlamaIndex media block."""

import pytest
from ag_ui.core import UserMessage
from llama_index.protocols.ag_ui.utils import ag_ui_message_to_llama_index_message


@pytest.mark.parametrize(
    ("part_type", "mime_type", "block_type"),
    [
        ("image", "image/png", "ImageBlock"),
        ("document", "application/pdf", "DocumentBlock"),
    ],
)
def test_attachment_is_not_duplicated(part_type, mime_type, block_type) -> None:
    message = UserMessage.model_validate(
        {
            "id": "attachment-turn",
            "role": "user",
            "content": [
                {"type": "text", "text": "What is in this attachment?"},
                {
                    "type": part_type,
                    "source": {
                        "type": "data",
                        "value": "AA==",
                        "mimeType": mime_type,
                    },
                },
            ],
        }
    )

    converted = ag_ui_message_to_llama_index_message(message)
    assert [type(block).__name__ for block in converted.blocks] == [
        "TextBlock",
        block_type,
    ]
