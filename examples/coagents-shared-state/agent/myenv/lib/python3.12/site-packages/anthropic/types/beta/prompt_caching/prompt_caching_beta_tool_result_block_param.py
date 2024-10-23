# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing import Union, Iterable, Optional
from typing_extensions import Literal, Required, TypeAlias, TypedDict

from .prompt_caching_beta_text_block_param import PromptCachingBetaTextBlockParam
from .prompt_caching_beta_image_block_param import PromptCachingBetaImageBlockParam
from .prompt_caching_beta_cache_control_ephemeral_param import PromptCachingBetaCacheControlEphemeralParam

__all__ = ["PromptCachingBetaToolResultBlockParam", "Content"]

Content: TypeAlias = Union[PromptCachingBetaTextBlockParam, PromptCachingBetaImageBlockParam]


class PromptCachingBetaToolResultBlockParam(TypedDict, total=False):
    tool_use_id: Required[str]

    type: Required[Literal["tool_result"]]

    cache_control: Optional[PromptCachingBetaCacheControlEphemeralParam]

    content: Union[str, Iterable[Content]]

    is_error: bool
