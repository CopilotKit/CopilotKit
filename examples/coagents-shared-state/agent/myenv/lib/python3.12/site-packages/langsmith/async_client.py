"""The Async LangSmith Client."""

from __future__ import annotations

import asyncio
import datetime
import uuid
from typing import (
    Any,
    AsyncIterator,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Tuple,
    Union,
    cast,
)

import httpx

from langsmith import client as ls_client
from langsmith import schemas as ls_schemas
from langsmith import utils as ls_utils
from langsmith._internal import _beta_decorator as ls_beta


class AsyncClient:
    """Async Client for interacting with the LangSmith API."""

    __slots__ = ("_retry_config", "_client", "_web_url")

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout_ms: Optional[
            Union[
                int, Tuple[Optional[int], Optional[int], Optional[int], Optional[int]]
            ]
        ] = None,
        retry_config: Optional[Mapping[str, Any]] = None,
        web_url: Optional[str] = None,
    ):
        """Initialize the async client."""
        ls_beta._warn_once("Class AsyncClient is in beta.")
        self._retry_config = retry_config or {"max_retries": 3}
        _headers = {
            "Content-Type": "application/json",
        }
        api_key = ls_utils.get_api_key(api_key)
        api_url = ls_utils.get_api_url(api_url)
        if api_key:
            _headers[ls_client.X_API_KEY] = api_key
        ls_client._validate_api_key_if_hosted(api_url, api_key)

        if isinstance(timeout_ms, int):
            timeout_: Union[Tuple, float] = (timeout_ms / 1000, None, None, None)
        elif isinstance(timeout_ms, tuple):
            timeout_ = tuple([t / 1000 if t is not None else None for t in timeout_ms])
        else:
            timeout_ = 10
        self._client = httpx.AsyncClient(
            base_url=api_url, headers=_headers, timeout=timeout_
        )
        self._web_url = web_url

    async def __aenter__(self) -> AsyncClient:
        """Enter the async client."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the async client."""
        await self.aclose()

    async def aclose(self):
        """Close the async client."""
        await self._client.aclose()

    @property
    def _api_url(self):
        return str(self._client.base_url)

    @property
    def _host_url(self) -> str:
        """The web host url."""
        return ls_utils.get_host_url(self._web_url, self._api_url)

    async def _arequest_with_retries(
        self,
        method: str,
        endpoint: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """Make an async HTTP request with retries."""
        max_retries = cast(int, self._retry_config.get("max_retries", 3))
        for attempt in range(max_retries):
            try:
                response = await self._client.request(method, endpoint, **kwargs)
                ls_utils.raise_for_status_with_text(response)
                return response
            except httpx.HTTPStatusError as e:
                if attempt == max_retries - 1:
                    raise ls_utils.LangSmithAPIError(f"HTTP error: {repr(e)}")
                await asyncio.sleep(2**attempt)
            except httpx.RequestError as e:
                if attempt == max_retries - 1:
                    raise ls_utils.LangSmithConnectionError(f"Request error: {repr(e)}")
                await asyncio.sleep(2**attempt)
        raise ls_utils.LangSmithAPIError(
            "Unexpected error connecting to the LangSmith API"
        )

    async def _aget_paginated_list(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Get a paginated list of items."""
        params = params or {}
        offset = params.get("offset", 0)
        params["limit"] = params.get("limit", 100)
        while True:
            params["offset"] = offset
            response = await self._arequest_with_retries("GET", path, params=params)
            items = response.json()
            if not items:
                break
            for item in items:
                yield item
            if len(items) < params["limit"]:
                break
            offset += len(items)

    async def _aget_cursor_paginated_list(
        self,
        path: str,
        *,
        body: Optional[dict] = None,
        request_method: str = "POST",
        data_key: str = "runs",
    ) -> AsyncIterator[dict]:
        """Get a cursor paginated list of items."""
        params_ = body.copy() if body else {}
        while True:
            response = await self._arequest_with_retries(
                request_method,
                path,
                content=ls_client._dumps_json(params_),
            )
            response_body = response.json()
            if not response_body:
                break
            if not response_body.get(data_key):
                break
            for run in response_body[data_key]:
                yield run
            cursors = response_body.get("cursors")
            if not cursors:
                break
            if not cursors.get("next"):
                break
            params_["cursor"] = cursors["next"]

    async def create_run(
        self,
        name: str,
        inputs: Dict[str, Any],
        run_type: str,
        *,
        project_name: Optional[str] = None,
        revision_id: Optional[ls_client.ID_TYPE] = None,
        **kwargs: Any,
    ) -> None:
        """Create a run."""
        run_create = {
            "name": name,
            "id": kwargs.get("id") or uuid.uuid4(),
            "inputs": inputs,
            "run_type": run_type,
            "session_name": project_name or ls_utils.get_tracer_project(),
            "revision_id": revision_id,
            **kwargs,
        }
        await self._arequest_with_retries(
            "POST", "/runs", content=ls_client._dumps_json(run_create)
        )

    async def update_run(
        self,
        run_id: ls_client.ID_TYPE,
        **kwargs: Any,
    ) -> None:
        """Update a run."""
        data = {**kwargs, "id": ls_client._as_uuid(run_id)}
        await self._arequest_with_retries(
            "PATCH",
            f"/runs/{ls_client._as_uuid(run_id)}",
            content=ls_client._dumps_json(data),
        )

    async def read_run(self, run_id: ls_client.ID_TYPE) -> ls_schemas.Run:
        """Read a run."""
        response = await self._arequest_with_retries(
            "GET",
            f"/runs/{ls_client._as_uuid(run_id)}",
        )
        return ls_schemas.Run(**response.json())

    async def list_runs(
        self,
        *,
        project_id: Optional[
            Union[ls_client.ID_TYPE, Sequence[ls_client.ID_TYPE]]
        ] = None,
        project_name: Optional[Union[str, Sequence[str]]] = None,
        run_type: Optional[str] = None,
        trace_id: Optional[ls_client.ID_TYPE] = None,
        reference_example_id: Optional[ls_client.ID_TYPE] = None,
        query: Optional[str] = None,
        filter: Optional[str] = None,
        trace_filter: Optional[str] = None,
        tree_filter: Optional[str] = None,
        is_root: Optional[bool] = None,
        parent_run_id: Optional[ls_client.ID_TYPE] = None,
        start_time: Optional[datetime.datetime] = None,
        error: Optional[bool] = None,
        run_ids: Optional[Sequence[ls_client.ID_TYPE]] = None,
        select: Optional[Sequence[str]] = None,
        limit: Optional[int] = None,
        **kwargs: Any,
    ) -> AsyncIterator[ls_schemas.Run]:
        """List runs from the LangSmith API.

        Parameters
        ----------
        project_id : UUID or None, default=None
            The ID(s) of the project to filter by.
        project_name : str or None, default=None
            The name(s) of the project to filter by.
        run_type : str or None, default=None
            The type of the runs to filter by.
        trace_id : UUID or None, default=None
            The ID of the trace to filter by.
        reference_example_id : UUID or None, default=None
            The ID of the reference example to filter by.
        query : str or None, default=None
            The query string to filter by.
        filter : str or None, default=None
            The filter string to filter by.
        trace_filter : str or None, default=None
            Filter to apply to the ROOT run in the trace tree. This is meant to
            be used in conjunction with the regular `filter` parameter to let you
            filter runs by attributes of the root run within a trace.
        tree_filter : str or None, default=None
            Filter to apply to OTHER runs in the trace tree, including
            sibling and child runs. This is meant to be used in conjunction with
            the regular `filter` parameter to let you filter runs by attributes
            of any run within a trace.
        is_root : bool or None, default=None
            Whether to filter by root runs.
        parent_run_id : UUID or None, default=None
            The ID of the parent run to filter by.
        start_time : datetime or None, default=None
            The start time to filter by.
        error : bool or None, default=None
            Whether to filter by error status.
        run_ids : List[str or UUID] or None, default=None
            The IDs of the runs to filter by.
        limit : int or None, default=None
            The maximum number of runs to return.
        **kwargs : Any
            Additional keyword arguments.

        Yields:
        ------
        Run
            The runs.

        Examples:
        --------
        List all runs in a project:

        .. code-block:: python

            project_runs = client.list_runs(project_name="<your_project>")

        List LLM and Chat runs in the last 24 hours:

        .. code-block:: python

            todays_llm_runs = client.list_runs(
                project_name="<your_project>",
                start_time=datetime.now() - timedelta(days=1),
                run_type="llm",
            )

        List root traces in a project:

        .. code-block:: python

            root_runs = client.list_runs(project_name="<your_project>", is_root=1)

        List runs without errors:

        .. code-block:: python

            correct_runs = client.list_runs(project_name="<your_project>", error=False)

        List runs and only return their inputs/outputs (to speed up the query):

        .. code-block:: python

            input_output_runs = client.list_runs(
                project_name="<your_project>", select=["inputs", "outputs"]
            )

        List runs by run ID:

        .. code-block:: python

            run_ids = [
                "a36092d2-4ad5-4fb4-9c0d-0dba9a2ed836",
                "9398e6be-964f-4aa4-8ae9-ad78cd4b7074",
            ]
            selected_runs = client.list_runs(id=run_ids)

        List all "chain" type runs that took more than 10 seconds and had
        `total_tokens` greater than 5000:

        .. code-block:: python

            chain_runs = client.list_runs(
                project_name="<your_project>",
                filter='and(eq(run_type, "chain"), gt(latency, 10), gt(total_tokens, 5000))',
            )

        List all runs called "extractor" whose root of the trace was assigned feedback "user_score" score of 1:

        .. code-block:: python

            good_extractor_runs = client.list_runs(
                project_name="<your_project>",
                filter='eq(name, "extractor")',
                trace_filter='and(eq(feedback_key, "user_score"), eq(feedback_score, 1))',
            )

        List all runs that started after a specific timestamp and either have "error" not equal to null or a "Correctness" feedback score equal to 0:

        .. code-block:: python

            complex_runs = client.list_runs(
                project_name="<your_project>",
                filter='and(gt(start_time, "2023-07-15T12:34:56Z"), or(neq(error, null), and(eq(feedback_key, "Correctness"), eq(feedback_score, 0.0))))',
            )

        List all runs where `tags` include "experimental" or "beta" and `latency` is greater than 2 seconds:

        .. code-block:: python

            tagged_runs = client.list_runs(
                project_name="<your_project>",
                filter='and(or(has(tags, "experimental"), has(tags, "beta")), gt(latency, 2))',
            )
        """
        project_ids = []
        if isinstance(project_id, (uuid.UUID, str)):
            project_ids.append(project_id)
        elif isinstance(project_id, list):
            project_ids.extend(project_id)
        if project_name is not None:
            if isinstance(project_name, str):
                project_name = [project_name]
            projects = await asyncio.gather(
                *[self.read_project(project_name=name) for name in project_name]
            )
            project_ids.extend([project.id for project in projects])

        body_query: Dict[str, Any] = {
            "session": project_ids if project_ids else None,
            "run_type": run_type,
            "reference_example": (
                [reference_example_id] if reference_example_id else None
            ),
            "query": query,
            "filter": filter,
            "trace_filter": trace_filter,
            "tree_filter": tree_filter,
            "is_root": is_root,
            "parent_run": parent_run_id,
            "start_time": start_time.isoformat() if start_time else None,
            "error": error,
            "id": run_ids,
            "trace": trace_id,
            "select": select,
            **kwargs,
        }
        if project_ids:
            body_query["session"] = [
                str(ls_client._as_uuid(id_)) for id_ in project_ids
            ]
        body = {k: v for k, v in body_query.items() if v is not None}
        ix = 0
        async for run in self._aget_cursor_paginated_list("/runs/query", body=body):
            yield ls_schemas.Run(**run)
            ix += 1
            if limit is not None and ix >= limit:
                break

    async def share_run(
        self, run_id: ls_client.ID_TYPE, *, share_id: Optional[ls_client.ID_TYPE] = None
    ) -> str:
        """Get a share link for a run asynchronously.

        Args:
            run_id (ID_TYPE): The ID of the run to share.
            share_id (Optional[ID_TYPE], optional): Custom share ID.
                If not provided, a random UUID will be generated.

        Returns:
            str: The URL of the shared run.

        Raises:
            httpx.HTTPStatusError: If the API request fails.
        """
        run_id_ = ls_client._as_uuid(run_id, "run_id")
        data = {
            "run_id": str(run_id_),
            "share_token": str(share_id or uuid.uuid4()),
        }
        response = await self._arequest_with_retries(
            "PUT",
            f"/runs/{run_id_}/share",
            content=ls_client._dumps_json(data),
        )
        ls_utils.raise_for_status_with_text(response)
        share_token = response.json()["share_token"]
        return f"{self._host_url}/public/{share_token}/r"

    async def run_is_shared(self, run_id: ls_client.ID_TYPE) -> bool:
        """Get share state for a run asynchronously."""
        link = await self.read_run_shared_link(ls_client._as_uuid(run_id, "run_id"))
        return link is not None

    async def read_run_shared_link(self, run_id: ls_client.ID_TYPE) -> Optional[str]:
        """Retrieve the shared link for a specific run asynchronously.

        Args:
            run_id (ID_TYPE): The ID of the run.

        Returns:
            Optional[str]: The shared link for the run, or None if the link is not
            available.

        Raises:
            httpx.HTTPStatusError: If the API request fails.
        """
        response = await self._arequest_with_retries(
            "GET",
            f"/runs/{ls_client._as_uuid(run_id, 'run_id')}/share",
        )
        ls_utils.raise_for_status_with_text(response)
        result = response.json()
        if result is None or "share_token" not in result:
            return None
        return f"{self._host_url}/public/{result['share_token']}/r"

    async def create_project(
        self,
        project_name: str,
        **kwargs: Any,
    ) -> ls_schemas.TracerSession:
        """Create a project."""
        data = {"name": project_name, **kwargs}
        response = await self._arequest_with_retries(
            "POST", "/sessions", content=ls_client._dumps_json(data)
        )
        return ls_schemas.TracerSession(**response.json())

    async def read_project(
        self,
        project_name: Optional[str] = None,
        project_id: Optional[ls_client.ID_TYPE] = None,
    ) -> ls_schemas.TracerSession:
        """Read a project."""
        if project_id:
            response = await self._arequest_with_retries(
                "GET", f"/sessions/{ls_client._as_uuid(project_id)}"
            )
        elif project_name:
            response = await self._arequest_with_retries(
                "GET", "/sessions", params={"name": project_name}
            )
        else:
            raise ValueError("Either project_name or project_id must be provided")

        data = response.json()
        if isinstance(data, list):
            if not data:
                raise ls_utils.LangSmithNotFoundError(
                    f"Project {project_name} not found"
                )
            return ls_schemas.TracerSession(**data[0])
        return ls_schemas.TracerSession(**data)

    async def delete_project(
        self, *, project_name: Optional[str] = None, project_id: Optional[str] = None
    ) -> None:
        """Delete a project from LangSmith.

        Parameters
        ----------
        project_name : str or None, default=None
            The name of the project to delete.
        project_id : str or None, default=None
            The ID of the project to delete.
        """
        if project_id is None and project_name is None:
            raise ValueError("Either project_name or project_id must be provided")
        if project_id is None:
            project = await self.read_project(project_name=project_name)
            project_id = str(project.id)
        if not project_id:
            raise ValueError("Project not found")
        await self._arequest_with_retries(
            "DELETE",
            f"/sessions/{ls_client._as_uuid(project_id)}",
        )

    async def create_dataset(
        self,
        dataset_name: str,
        **kwargs: Any,
    ) -> ls_schemas.Dataset:
        """Create a dataset."""
        data = {"name": dataset_name, **kwargs}
        response = await self._arequest_with_retries(
            "POST", "/datasets", content=ls_client._dumps_json(data)
        )
        return ls_schemas.Dataset(**response.json())

    async def read_dataset(
        self,
        dataset_name: Optional[str] = None,
        dataset_id: Optional[ls_client.ID_TYPE] = None,
    ) -> ls_schemas.Dataset:
        """Read a dataset."""
        if dataset_id:
            response = await self._arequest_with_retries(
                "GET", f"/datasets/{ls_client._as_uuid(dataset_id)}"
            )
        elif dataset_name:
            response = await self._arequest_with_retries(
                "GET", "/datasets", params={"name": dataset_name}
            )
        else:
            raise ValueError("Either dataset_name or dataset_id must be provided")

        data = response.json()
        if isinstance(data, list):
            if not data:
                raise ls_utils.LangSmithNotFoundError(
                    f"Dataset {dataset_name} not found"
                )
            return ls_schemas.Dataset(**data[0])
        return ls_schemas.Dataset(**data)

    async def delete_dataset(self, dataset_id: ls_client.ID_TYPE) -> None:
        """Delete a dataset."""
        await self._arequest_with_retries(
            "DELETE",
            f"/datasets/{ls_client._as_uuid(dataset_id)}",
        )

    async def list_datasets(
        self,
        **kwargs: Any,
    ) -> AsyncIterator[ls_schemas.Dataset]:
        """List datasets."""
        async for dataset in self._aget_paginated_list("/datasets", params=kwargs):
            yield ls_schemas.Dataset(**dataset)

    async def create_example(
        self,
        inputs: Dict[str, Any],
        outputs: Optional[Dict[str, Any]] = None,
        dataset_id: Optional[ls_client.ID_TYPE] = None,
        dataset_name: Optional[str] = None,
        **kwargs: Any,
    ) -> ls_schemas.Example:
        """Create an example."""
        if dataset_id is None and dataset_name is None:
            raise ValueError("Either dataset_id or dataset_name must be provided")
        if dataset_id is None:
            dataset = await self.read_dataset(dataset_name=dataset_name)
            dataset_id = dataset.id

        data = {
            "inputs": inputs,
            "outputs": outputs,
            "dataset_id": str(dataset_id),
            **kwargs,
        }
        response = await self._arequest_with_retries(
            "POST", "/examples", content=ls_client._dumps_json(data)
        )
        return ls_schemas.Example(**response.json())

    async def read_example(self, example_id: ls_client.ID_TYPE) -> ls_schemas.Example:
        """Read an example."""
        response = await self._arequest_with_retries(
            "GET", f"/examples/{ls_client._as_uuid(example_id)}"
        )
        return ls_schemas.Example(**response.json())

    async def list_examples(
        self,
        *,
        dataset_id: Optional[ls_client.ID_TYPE] = None,
        dataset_name: Optional[str] = None,
        **kwargs: Any,
    ) -> AsyncIterator[ls_schemas.Example]:
        """List examples."""
        params = kwargs.copy()
        if dataset_id:
            params["dataset"] = ls_client._as_uuid(dataset_id)
        elif dataset_name:
            dataset = await self.read_dataset(dataset_name=dataset_name)
            params["dataset"] = dataset.id

        async for example in self._aget_paginated_list("/examples", params=params):
            yield ls_schemas.Example(**example)

    async def create_feedback(
        self,
        run_id: Optional[ls_client.ID_TYPE],
        key: str,
        score: Optional[float] = None,
        value: Optional[Any] = None,
        comment: Optional[str] = None,
        **kwargs: Any,
    ) -> ls_schemas.Feedback:
        """Create feedback for a run.

        Args:
            run_id (Optional[ls_client.ID_TYPE]): The ID of the run to provide feedback for.
                Can be None for project-level feedback.
            key (str): The name of the metric or aspect this feedback is about.
            score (Optional[float]): The score to rate this run on the metric or aspect.
            value (Optional[Any]): The display value or non-numeric value for this feedback.
            comment (Optional[str]): A comment about this feedback.
            **kwargs: Additional keyword arguments to include in the feedback data.

        Returns:
            ls_schemas.Feedback: The created feedback object.

        Raises:
            httpx.HTTPStatusError: If the API request fails.
        """  # noqa: E501
        data = {
            "run_id": ls_client._ensure_uuid(run_id, accept_null=True),
            "key": key,
            "score": score,
            "value": value,
            "comment": comment,
            **kwargs,
        }
        response = await self._arequest_with_retries(
            "POST", "/feedback", content=ls_client._dumps_json(data)
        )
        return ls_schemas.Feedback(**response.json())

    async def create_feedback_from_token(
        self,
        token_or_url: Union[str, uuid.UUID],
        score: Union[float, int, bool, None] = None,
        *,
        value: Union[float, int, bool, str, dict, None] = None,
        correction: Union[dict, None] = None,
        comment: Union[str, None] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        """Create feedback from a presigned token or URL.

        Args:
            token_or_url (Union[str, uuid.UUID]): The token or URL from which to create
                 feedback.
            score (Union[float, int, bool, None], optional): The score of the feedback.
                Defaults to None.
            value (Union[float, int, bool, str, dict, None], optional): The value of the
                feedback. Defaults to None.
            correction (Union[dict, None], optional): The correction of the feedback.
                Defaults to None.
            comment (Union[str, None], optional): The comment of the feedback. Defaults
                to None.
            metadata (Optional[dict], optional): Additional metadata for the feedback.
                Defaults to None.

        Raises:
            ValueError: If the source API URL is invalid.

        Returns:
            None: This method does not return anything.
        """
        source_api_url, token_uuid = ls_client._parse_token_or_url(
            token_or_url, self._api_url, num_parts=1
        )
        if source_api_url != self._api_url:
            raise ValueError(f"Invalid source API URL. {source_api_url}")
        response = await self._arequest_with_retries(
            "POST",
            f"/feedback/tokens/{ls_client._as_uuid(token_uuid)}",
            content=ls_client._dumps_json(
                {
                    "score": score,
                    "value": value,
                    "correction": correction,
                    "comment": comment,
                    "metadata": metadata,
                    # TODO: Add ID once the API supports it.
                }
            ),
        )
        ls_utils.raise_for_status_with_text(response)

    async def create_presigned_feedback_token(
        self,
        run_id: ls_client.ID_TYPE,
        feedback_key: str,
        *,
        expiration: Optional[datetime.datetime | datetime.timedelta] = None,
        feedback_config: Optional[ls_schemas.FeedbackConfig] = None,
        feedback_id: Optional[ls_client.ID_TYPE] = None,
    ) -> ls_schemas.FeedbackIngestToken:
        """Create a pre-signed URL to send feedback data to.

        This is useful for giving browser-based clients a way to upload
        feedback data directly to LangSmith without accessing the
        API key.

        Args:
            run_id:
            feedback_key:
            expiration: The expiration time of the pre-signed URL.
                Either a datetime or a timedelta offset from now.
                Default to 3 hours.
            feedback_config: FeedbackConfig or None.
                If creating a feedback_key for the first time,
                this defines how the metric should be interpreted,
                such as a continuous score (w/ optional bounds),
                or distribution over categorical values.
            feedback_id: The ID of the feedback to create. If not provided, a new
                feedback will be created.

        Returns:
            The pre-signed URL for uploading feedback data.
        """
        body: Dict[str, Any] = {
            "run_id": run_id,
            "feedback_key": feedback_key,
            "feedback_config": feedback_config,
            "id": feedback_id or str(uuid.uuid4()),
        }
        if expiration is None:
            body["expires_in"] = ls_schemas.TimeDeltaInput(
                days=0,
                hours=3,
                minutes=0,
            )
        elif isinstance(expiration, datetime.datetime):
            body["expires_at"] = expiration.isoformat()
        elif isinstance(expiration, datetime.timedelta):
            body["expires_in"] = ls_schemas.TimeDeltaInput(
                days=expiration.days,
                hours=expiration.seconds // 3600,
                minutes=(expiration.seconds % 3600) // 60,
            )
        else:
            raise ValueError(
                f"Invalid expiration type: {type(expiration)}. "
                "Expected datetime.datetime or datetime.timedelta."
            )

        response = await self._arequest_with_retries(
            "POST",
            "/feedback/tokens",
            content=ls_client._dumps_json(body),
        )
        return ls_schemas.FeedbackIngestToken(**response.json())

    async def read_feedback(
        self, feedback_id: ls_client.ID_TYPE
    ) -> ls_schemas.Feedback:
        """Read feedback."""
        response = await self._arequest_with_retries(
            "GET", f"/feedback/{ls_client._as_uuid(feedback_id)}"
        )
        return ls_schemas.Feedback(**response.json())

    async def list_feedback(
        self,
        *,
        run_ids: Optional[Sequence[ls_client.ID_TYPE]] = None,
        feedback_key: Optional[Sequence[str]] = None,
        feedback_source_type: Optional[Sequence[ls_schemas.FeedbackSourceType]] = None,
        limit: Optional[int] = None,
        **kwargs: Any,
    ) -> AsyncIterator[ls_schemas.Feedback]:
        """List feedback."""
        params = {
            "run": (
                [str(ls_client._as_uuid(id_)) for id_ in run_ids] if run_ids else None
            ),
            "limit": min(limit, 100) if limit is not None else 100,
            **kwargs,
        }
        if feedback_key is not None:
            params["key"] = feedback_key
        if feedback_source_type is not None:
            params["source"] = feedback_source_type
        ix = 0
        async for feedback in self._aget_paginated_list("/feedback", params=params):
            yield ls_schemas.Feedback(**feedback)
            ix += 1
            if limit is not None and ix >= limit:
                break

    @ls_beta.warn_beta
    async def index_dataset(
        self,
        *,
        dataset_id: ls_client.ID_TYPE,
        tag: str = "latest",
        **kwargs: Any,
    ) -> None:
        """Enable dataset indexing. Examples are indexed by their inputs.

        This enables searching for similar examples by inputs with
        ``client.similar_examples()``.

        Args:
            dataset_id (UUID): The ID of the dataset to index.
            tag (str, optional): The version of the dataset to index. If 'latest'
                then any updates to the dataset (additions, updates, deletions of
                examples) will be reflected in the index.

        Returns:
            None

        Raises:
            requests.HTTPError
        """  # noqa: E501
        dataset_id = ls_client._as_uuid(dataset_id, "dataset_id")
        resp = await self._arequest_with_retries(
            "POST",
            f"/datasets/{dataset_id}/index",
            content=ls_client._dumps_json({"tag": tag, **kwargs}),
        )
        ls_utils.raise_for_status_with_text(resp)

    @ls_beta.warn_beta
    async def similar_examples(
        self,
        inputs: dict,
        /,
        *,
        limit: int,
        dataset_id: ls_client.ID_TYPE,
        filter: Optional[str] = None,
        **kwargs: Any,
    ) -> List[ls_schemas.ExampleSearch]:
        r"""Retrieve the dataset examples whose inputs best match the current inputs.

        **Note**: Must have few-shot indexing enabled for the dataset. See
        ``client.index_dataset()``.

        Args:
            inputs (dict): The inputs to use as a search query. Must match the dataset
                input schema. Must be JSON serializable.
            limit (int): The maximum number of examples to return.
            dataset_id (str or UUID): The ID of the dataset to search over.
            filter (str, optional): A filter string to apply to the search results. Uses
                the same syntax as the `filter` parameter in `list_runs()`. Only a subset
                of operations are supported. Defaults to None.
            kwargs (Any): Additional keyword args to pass as part of request body.

        Returns:
            List of ExampleSearch objects.

        Example:
            .. code-block:: python

                from langsmith import Client

                client = Client()
                await client.similar_examples(
                    {"question": "When would i use the runnable generator"},
                    limit=3,
                    dataset_id="...",
                )

            .. code-block:: pycon

                [
                    ExampleSearch(
                        inputs={'question': 'How do I cache a Chat model? What caches can I use?'},
                        outputs={'answer': 'You can use LangChain\'s caching layer for Chat Models. This can save you money by reducing the number of API calls you make to the LLM provider, if you\'re often requesting the same completion multiple times, and speed up your application.\n\n```python\n\nfrom langchain.cache import InMemoryCache\nlangchain.llm_cache = InMemoryCache()\n\n# The first time, it is not yet in cache, so it should take longer\nllm.predict(\'Tell me a joke\')\n\n```\n\nYou can also use SQLite Cache which uses a SQLite database:\n\n```python\n  rm .langchain.db\n\nfrom langchain.cache import SQLiteCache\nlangchain.llm_cache = SQLiteCache(database_path=".langchain.db")\n\n# The first time, it is not yet in cache, so it should take longer\nllm.predict(\'Tell me a joke\') \n```\n'},
                        metadata=None,
                        id=UUID('b2ddd1c4-dff6-49ae-8544-f48e39053398'),
                        dataset_id=UUID('01b6ce0f-bfb6-4f48-bbb8-f19272135d40')
                    ),
                    ExampleSearch(
                        inputs={'question': "What's a runnable lambda?"},
                        outputs={'answer': "A runnable lambda is an object that implements LangChain's `Runnable` interface and runs a callbale (i.e., a function). Note the function must accept a single argument."},
                        metadata=None,
                        id=UUID('f94104a7-2434-4ba7-8293-6a283f4860b4'),
                        dataset_id=UUID('01b6ce0f-bfb6-4f48-bbb8-f19272135d40')
                    ),
                    ExampleSearch(
                        inputs={'question': 'Show me how to use RecursiveURLLoader'},
                        outputs={'answer': 'The RecursiveURLLoader comes from the langchain.document_loaders.recursive_url_loader module. Here\'s an example of how to use it:\n\n```python\nfrom langchain.document_loaders.recursive_url_loader import RecursiveUrlLoader\n\n# Create an instance of RecursiveUrlLoader with the URL you want to load\nloader = RecursiveUrlLoader(url="https://example.com")\n\n# Load all child links from the URL page\nchild_links = loader.load()\n\n# Print the child links\nfor link in child_links:\n    print(link)\n```\n\nMake sure to replace "https://example.com" with the actual URL you want to load. The load() method returns a list of child links found on the URL page. You can iterate over this list to access each child link.'},
                        metadata=None,
                        id=UUID('0308ea70-a803-4181-a37d-39e95f138f8c'),
                        dataset_id=UUID('01b6ce0f-bfb6-4f48-bbb8-f19272135d40')
                    ),
                ]

        """  # noqa: E501
        dataset_id = ls_client._as_uuid(dataset_id, "dataset_id")
        req = {
            "inputs": inputs,
            "limit": limit,
            **kwargs,
        }
        if filter:
            req["filter"] = filter

        resp = await self._arequest_with_retries(
            "POST",
            f"/datasets/{dataset_id}/search",
            content=ls_client._dumps_json(req),
        )
        ls_utils.raise_for_status_with_text(resp)
        examples = []
        for ex in resp.json()["examples"]:
            examples.append(ls_schemas.ExampleSearch(**ex, dataset_id=dataset_id))
        return examples
