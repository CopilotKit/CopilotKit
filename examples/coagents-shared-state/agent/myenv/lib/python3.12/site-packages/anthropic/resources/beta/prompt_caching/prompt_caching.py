# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from .messages import (
    Messages,
    AsyncMessages,
    MessagesWithRawResponse,
    AsyncMessagesWithRawResponse,
    MessagesWithStreamingResponse,
    AsyncMessagesWithStreamingResponse,
)
from ...._compat import cached_property
from ...._resource import SyncAPIResource, AsyncAPIResource

__all__ = ["PromptCaching", "AsyncPromptCaching"]


class PromptCaching(SyncAPIResource):
    @cached_property
    def messages(self) -> Messages:
        return Messages(self._client)

    @cached_property
    def with_raw_response(self) -> PromptCachingWithRawResponse:
        return PromptCachingWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> PromptCachingWithStreamingResponse:
        return PromptCachingWithStreamingResponse(self)


class AsyncPromptCaching(AsyncAPIResource):
    @cached_property
    def messages(self) -> AsyncMessages:
        return AsyncMessages(self._client)

    @cached_property
    def with_raw_response(self) -> AsyncPromptCachingWithRawResponse:
        return AsyncPromptCachingWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> AsyncPromptCachingWithStreamingResponse:
        return AsyncPromptCachingWithStreamingResponse(self)


class PromptCachingWithRawResponse:
    def __init__(self, prompt_caching: PromptCaching) -> None:
        self._prompt_caching = prompt_caching

    @cached_property
    def messages(self) -> MessagesWithRawResponse:
        return MessagesWithRawResponse(self._prompt_caching.messages)


class AsyncPromptCachingWithRawResponse:
    def __init__(self, prompt_caching: AsyncPromptCaching) -> None:
        self._prompt_caching = prompt_caching

    @cached_property
    def messages(self) -> AsyncMessagesWithRawResponse:
        return AsyncMessagesWithRawResponse(self._prompt_caching.messages)


class PromptCachingWithStreamingResponse:
    def __init__(self, prompt_caching: PromptCaching) -> None:
        self._prompt_caching = prompt_caching

    @cached_property
    def messages(self) -> MessagesWithStreamingResponse:
        return MessagesWithStreamingResponse(self._prompt_caching.messages)


class AsyncPromptCachingWithStreamingResponse:
    def __init__(self, prompt_caching: AsyncPromptCaching) -> None:
        self._prompt_caching = prompt_caching

    @cached_property
    def messages(self) -> AsyncMessagesWithStreamingResponse:
        return AsyncMessagesWithStreamingResponse(self._prompt_caching.messages)
