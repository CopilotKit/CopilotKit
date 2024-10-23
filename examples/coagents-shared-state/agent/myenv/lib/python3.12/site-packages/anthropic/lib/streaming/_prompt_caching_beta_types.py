from typing import Union
from typing_extensions import Literal

from ._types import (
    TextEvent,
    InputJsonEvent,
    RawMessageDeltaEvent,
    ContentBlockStopEvent,
    RawContentBlockDeltaEvent,
    RawContentBlockStartEvent,
)
from ...types import RawMessageStopEvent
from ...types.beta.prompt_caching import PromptCachingBetaMessage, RawPromptCachingBetaMessageStartEvent


class MessageStopEvent(RawMessageStopEvent):
    type: Literal["message_stop"]

    message: PromptCachingBetaMessage


PromptCachingBetaMessageStreamEvent = Union[
    RawPromptCachingBetaMessageStartEvent,
    MessageStopEvent,
    # same as non-beta
    TextEvent,
    InputJsonEvent,
    RawMessageDeltaEvent,
    RawContentBlockStartEvent,
    RawContentBlockDeltaEvent,
    ContentBlockStopEvent,
]
