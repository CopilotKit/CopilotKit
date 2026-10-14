"""Keep the AG-UI message shape used by the attachment demo supported."""

from ag_ui.core import UserMessage


def test_image_attachment_message_accepts_binary_part() -> None:
    message = UserMessage.model_validate(
        {
            "id": "attachment-turn",
            "role": "user",
            "content": [
                {"type": "text", "text": "What is in this image?"},
                {
                    "type": "image",
                    "source": {
                        "type": "data",
                        "value": "AA==",
                        "mimeType": "image/png",
                    },
                },
                {"type": "binary", "mimeType": "image/png", "data": "AA=="},
            ],
        }
    )

    assert [part.type for part in message.content] == ["text", "image", "binary"]
