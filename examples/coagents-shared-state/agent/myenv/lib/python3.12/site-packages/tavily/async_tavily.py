import asyncio
import json
import os
from typing import Literal, Sequence, Optional, List, Union

import httpx

from .utils import get_max_items_from_list
from .errors import UsageLimitExceededError, InvalidAPIKeyError, MissingAPIKeyError, BadRequestError


class AsyncTavilyClient:
    """
    Async Tavily API client class.
    """

    def __init__(self, api_key: Optional[str] = None,
                 company_info_tags: Sequence[str] = ("news", "general", "finance")):
        if api_key is None:
            api_key = os.getenv("TAVILY_API_KEY")

        if not api_key:
            raise MissingAPIKeyError()

        self._base_data = {
            "api_key": api_key,
        }
        self._client_creator = lambda: httpx.AsyncClient(
            headers={
                "Content-Type": "application/json",
            },
            base_url="https://api.tavily.com",
            timeout=180,
        )
        self._company_info_tags = company_info_tags

    async def _search(
            self,
            query: str,
            search_depth: Literal["basic", "advanced"] = "basic",
            topic: str = "general",
            days: int = 3,
            max_results: int = 5,
            include_domains: Sequence[str] = None,
            exclude_domains: Sequence[str] = None,
            include_answer: bool = False,
            include_raw_content: bool = False,
            include_images: bool = False,
            **kwargs,
    ) -> dict:
        """
        Internal search method to send the request to the API.
        """
        data = {
            **self._base_data,
            "query": query,
            "search_depth": search_depth,
            "topic": topic,
            "days": days,
            "include_answer": include_answer,
            "include_raw_content": include_raw_content,
            "max_results": max_results,
            "include_domains": include_domains,
            "exclude_domains": exclude_domains,
            "include_images": include_images,
        }

        if kwargs:
            data.update(kwargs)

        async with self._client_creator() as client:
            response = await client.post("/search", content=json.dumps(data))

        if response.status_code == 200:
            return response.json()
        elif response.status_code == 429:
            detail = 'Too many requests.'
            try:
                detail = response.json()['detail']['error']
            except:
                pass

            raise UsageLimitExceededError(detail)
        elif response.status_code == 401:
            raise InvalidAPIKeyError()
        else:
            response.raise_for_status()  # Raises a HTTPError if the HTTP request returned an unsuccessful status code

    async def search(self,
                     query: str,
                     search_depth: Literal["basic", "advanced"] = "basic",
                     topic: Literal["general", "news"] = "general",
                     days: int = 3,
                     max_results: int = 5,
                     include_domains: Sequence[str] = None,
                     exclude_domains: Sequence[str] = None,
                     include_answer: bool = False,
                     include_raw_content: bool = False,
                     include_images: bool = False,
                     **kwargs,  # Accept custom arguments
                     ) -> dict:
        """
        Combined search method. Set search_depth to either "basic" or "advanced".
        """
        response_dict = await self._search(query,
                                           search_depth=search_depth,
                                           topic=topic,
                                           days=days,
                                           max_results=max_results,
                                           include_domains=include_domains,
                                           exclude_domains=exclude_domains,
                                           include_answer=include_answer,
                                           include_raw_content=include_raw_content,
                                           include_images=include_images,
                                           **kwargs,
                                           )

        tavily_results = response_dict.get("results", [])

        response_dict["results"] = tavily_results

        return response_dict

    async def _extract(
            self,
            urls: Union[List[str], str],
            **kwargs
    ) -> dict:
        """
        Internal extract method to send the request to the API.
        """
        data = {
            **self._base_data,
            "urls": urls,
        }
        if kwargs:
            data.update(kwargs)

        async with self._client_creator() as client:
            response = await client.post("/extract", content=json.dumps(data))

        if response.status_code == 200:
            return response.json()
        elif response.status_code == 400:
            detail = 'Bad request. The request was invalid or cannot be served.'
            try:
                detail = response.json()['detail']['error']
            except KeyError:
                pass
            raise BadRequestError(detail)
        elif response.status_code == 401:
            raise InvalidAPIKeyError()
        elif response.status_code == 429:
            detail = 'Too many requests.'
            try:
                detail = response.json()['detail']['error']
            except:
                pass

            raise UsageLimitExceededError(detail)
        else:
            response.raise_for_status()  # Raises a HTTPError if the HTTP request returned an unsuccessful status code

    async def extract(self,
                      urls: Union[List[str], str],  # Accept a list of URLs or a single URL
                      **kwargs,  # Accept custom arguments
                      ) -> dict:
        """
        Combined extract method.
        """
        response_dict = await self._extract(urls,
                                            **kwargs,
                                            )

        tavily_results = response_dict.get("results", [])
        failed_results = response_dict.get("failed_results", [])

        response_dict["results"] = tavily_results
        response_dict["failed_results"] = failed_results

        return response_dict

    async def get_search_context(self,
                                 query: str,
                                 search_depth: Literal["basic", "advanced"] = "basic",
                                 topic: Literal["general", "news"] = "general",
                                 days: int = 3,
                                 max_results: int = 5,
                                 include_domains: Sequence[str] = None,
                                 exclude_domains: Sequence[str] = None,
                                 max_tokens: int = 4000,
                                 **kwargs,  # Accept custom arguments
                                 ) -> str:
        """
        Get the search context for a query. Useful for getting only related content from retrieved websites
        without having to deal with context extraction and limitation yourself.

        max_tokens: The maximum number of tokens to return (based on openai token compute). Defaults to 4000.

        Returns a string of JSON containing the search context up to context limit.
        """
        response_dict = await self._search(query,
                                           search_depth=search_depth,
                                           topic=topic,
                                           days=days,
                                           max_results=max_results,
                                           include_domains=include_domains,
                                           exclude_domains=exclude_domains,
                                           include_answer=False,
                                           include_raw_content=False,
                                           include_images=False,
                                           **kwargs,
                                           )
        sources = response_dict.get("results", [])
        context = [{"url": source["url"], "content": source["content"]} for source in sources]
        return json.dumps(get_max_items_from_list(context, max_tokens))

    async def qna_search(self,
                         query: str,
                         search_depth: Literal["basic", "advanced"] = "advanced",
                         topic: Literal["general", "news"] = "general",
                         days: int = 3,
                         max_results: int = 5,
                         include_domains: Sequence[str] = None,
                         exclude_domains: Sequence[str] = None,
                         **kwargs,  # Accept custom arguments
                         ) -> str:
        """
        Q&A search method. Search depth is advanced by default to get the best answer.
        """
        response_dict = await self._search(query,
                                           search_depth=search_depth,
                                           topic=topic,
                                           days=days,
                                           max_results=max_results,
                                           include_domains=include_domains,
                                           exclude_domains=exclude_domains,
                                           include_raw_content=False,
                                           include_images=False,
                                           include_answer=True,
                                           **kwargs,
                                           )
        return response_dict.get("answer", "")

    async def get_company_info(self,
                               query: str,
                               search_depth: Literal["basic", "advanced"] = "advanced",
                               max_results: int = 5,
                               ) -> Sequence[dict]:
        """ Company information search method. Search depth is advanced by default to get the best answer. """

        async def _perform_search(topic: str):
            return await self._search(query,
                                      search_depth=search_depth,
                                      topic=topic,
                                      max_results=max_results,
                                      include_answer=False, )

        all_results = []
        for data in await asyncio.gather(*[_perform_search(topic) for topic in self._company_info_tags]):
            if "results" in data:
                all_results.extend(data["results"])

        # Sort all the results by score in descending order and take the top 'max_results' items
        sorted_results = sorted(all_results, key=lambda x: x["score"], reverse=True)[:max_results]

        return sorted_results
