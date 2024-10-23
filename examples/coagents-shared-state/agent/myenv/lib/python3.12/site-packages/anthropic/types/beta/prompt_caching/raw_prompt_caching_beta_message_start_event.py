# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing_extensions import Literal

from ...._models import BaseModel
from .prompt_caching_beta_message import PromptCachingBetaMessage

__all__ = ["RawPromptCachingBetaMessageStartEvent"]


class RawPromptCachingBetaMessageStartEvent(BaseModel):
    message: PromptCachingBetaMessage

    type: Literal["message_start"]
