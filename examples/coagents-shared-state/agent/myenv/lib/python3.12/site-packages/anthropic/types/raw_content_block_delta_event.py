# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Union
from typing_extensions import Literal, Annotated, TypeAlias

from .._utils import PropertyInfo
from .._models import BaseModel
from .text_delta import TextDelta
from .input_json_delta import InputJSONDelta

__all__ = ["RawContentBlockDeltaEvent", "Delta"]

Delta: TypeAlias = Annotated[Union[TextDelta, InputJSONDelta], PropertyInfo(discriminator="type")]


class RawContentBlockDeltaEvent(BaseModel):
    delta: Delta

    index: int

    type: Literal["content_block_delta"]
