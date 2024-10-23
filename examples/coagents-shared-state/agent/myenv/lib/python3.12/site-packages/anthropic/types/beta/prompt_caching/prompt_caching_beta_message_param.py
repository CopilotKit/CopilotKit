# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing import Union, Iterable
from typing_extensions import Literal, Required, TypedDict

from ...content_block import ContentBlock
from .prompt_caching_beta_text_block_param import PromptCachingBetaTextBlockParam
from .prompt_caching_beta_image_block_param import PromptCachingBetaImageBlockParam
from .prompt_caching_beta_tool_use_block_param import PromptCachingBetaToolUseBlockParam
from .prompt_caching_beta_tool_result_block_param import PromptCachingBetaToolResultBlockParam

__all__ = ["PromptCachingBetaMessageParam"]


class PromptCachingBetaMessageParam(TypedDict, total=False):
    content: Required[
        Union[
            str,
            Iterable[
                Union[
                    PromptCachingBetaTextBlockParam,
                    PromptCachingBetaImageBlockParam,
                    PromptCachingBetaToolUseBlockParam,
                    PromptCachingBetaToolResultBlockParam,
                    ContentBlock,
                ]
            ],
        ]
    ]

    role: Required[Literal["user", "assistant"]]
