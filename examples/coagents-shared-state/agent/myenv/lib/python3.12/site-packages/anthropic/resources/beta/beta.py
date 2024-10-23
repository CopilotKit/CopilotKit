# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from ..._compat import cached_property
from ..._resource import SyncAPIResource, AsyncAPIResource
from .prompt_caching import (
    PromptCaching,
    AsyncPromptCaching,
    PromptCachingWithRawResponse,
    AsyncPromptCachingWithRawResponse,
    PromptCachingWithStreamingResponse,
    AsyncPromptCachingWithStreamingResponse,
)
from .prompt_caching.prompt_caching import PromptCaching, AsyncPromptCaching

__all__ = ["Beta", "AsyncBeta"]


class Beta(SyncAPIResource):
    @cached_property
    def prompt_caching(self) -> PromptCaching:
        return PromptCaching(self._client)

    @cached_property
    def with_raw_response(self) -> BetaWithRawResponse:
        return BetaWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> BetaWithStreamingResponse:
        return BetaWithStreamingResponse(self)


class AsyncBeta(AsyncAPIResource):
    @cached_property
    def prompt_caching(self) -> AsyncPromptCaching:
        return AsyncPromptCaching(self._client)

    @cached_property
    def with_raw_response(self) -> AsyncBetaWithRawResponse:
        return AsyncBetaWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> AsyncBetaWithStreamingResponse:
        return AsyncBetaWithStreamingResponse(self)


class BetaWithRawResponse:
    def __init__(self, beta: Beta) -> None:
        self._beta = beta

    @cached_property
    def prompt_caching(self) -> PromptCachingWithRawResponse:
        return PromptCachingWithRawResponse(self._beta.prompt_caching)


class AsyncBetaWithRawResponse:
    def __init__(self, beta: AsyncBeta) -> None:
        self._beta = beta

    @cached_property
    def prompt_caching(self) -> AsyncPromptCachingWithRawResponse:
        return AsyncPromptCachingWithRawResponse(self._beta.prompt_caching)


class BetaWithStreamingResponse:
    def __init__(self, beta: Beta) -> None:
        self._beta = beta

    @cached_property
    def prompt_caching(self) -> PromptCachingWithStreamingResponse:
        return PromptCachingWithStreamingResponse(self._beta.prompt_caching)


class AsyncBetaWithStreamingResponse:
    def __init__(self, beta: AsyncBeta) -> None:
        self._beta = beta

    @cached_property
    def prompt_caching(self) -> AsyncPromptCachingWithStreamingResponse:
        return AsyncPromptCachingWithStreamingResponse(self._beta.prompt_caching)
