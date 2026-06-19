"""cvdiag_schema.py — GENERATED Pydantic v2 models for the CVDIAG envelope.

DO NOT EDIT BY HAND. This file is code-generated from
``showcase/harness/src/cvdiag/schema.json`` by
``showcase/integrations/_shared/codegen_cvdiag_schema.py``. Re-run that
script (and commit the result) whenever the schema changes; CI runs the
generator with ``--check`` to fail on drift. Plan unit: L0-C.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = 1

# UUIDv7 (RFC 9562) pattern for ``test_id`` — version nibble 7, variant 10.
TEST_ID_PATTERN = (
    r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
SPAN_ID_PATTERN = r"^[0-9a-f]{16}$"
SLUG_PATTERN = r"^[a-z][a-z0-9-]{0,63}$"


class CvdiagLayer(str, Enum):
    """Owning layer of a CVDIAG envelope (spec §5)."""

    PROBE = "probe"
    BACKEND = "backend"
    AIMOCK = "aimock"


class CvdiagOutcome(str, Enum):
    """Terminal outcome of a boundary observation (spec §5)."""

    OK = "ok"
    ERR = "err"
    TIMEOUT = "timeout"
    INFO = "info"


class CvdiagBoundary(str, Enum):
    """The closed set of 29 data-plane + 4 accounting boundaries (spec §5)."""

    PROBE_START = "probe.start"
    PROBE_NAVIGATE_COMPLETE = "probe.navigate.complete"
    PROBE_MESSAGE_SEND = "probe.message.send"
    PROBE_DOM_CONTAINER_MOUNT = "probe.dom.container.mount"
    PROBE_DOM_FIRSTTOKEN = "probe.dom.firsttoken"
    PROBE_DOM_ALTERNATE_CONTENT = "probe.dom.alternate_content"
    PROBE_SSE_EVENT = "probe.sse.event"
    PROBE_SSE_ABORTED = "probe.sse.aborted"
    PROBE_NETWORK_ERROR = "probe.network.error"
    PROBE_NETWORK_RESPONSE = "probe.network.response"
    PROBE_CONSOLE_ERROR = "probe.console.error"
    PROBE_EXIT = "probe.exit"
    BACKEND_REQUEST_INGRESS = "backend.request.ingress"
    BACKEND_AGENT_ENTER = "backend.agent.enter"
    BACKEND_LLM_CALL_START = "backend.llm.call.start"
    BACKEND_LLM_CALL_HEARTBEAT = "backend.llm.call.heartbeat"
    BACKEND_LLM_CALL_RESPONSE = "backend.llm.call.response"
    BACKEND_SSE_FIRST_BYTE = "backend.sse.first_byte"
    BACKEND_SSE_EVENT = "backend.sse.event"
    BACKEND_SSE_ABORTED = "backend.sse.aborted"
    BACKEND_AGENT_EXIT = "backend.agent.exit"
    BACKEND_RESPONSE_COMPLETE = "backend.response.complete"
    BACKEND_ERROR_CAUGHT = "backend.error.caught"
    AIMOCK_REQUEST_INGRESS = "aimock.request.ingress"
    AIMOCK_MATCH_DECISION = "aimock.match.decision"
    AIMOCK_RESPONSE_START = "aimock.response.start"
    AIMOCK_SSE_CHUNK = "aimock.sse.chunk"
    AIMOCK_RESPONSE_ABORTED = "aimock.response.aborted"
    AIMOCK_RESPONSE_COMPLETE = "aimock.response.complete"
    CVDIAG_PURGE_AUDIT = "cvdiag.purge_audit"
    CVDIAG_COLLISION_DETECTED = "cvdiag.collision_detected"
    CVDIAG_QUEUE_DROPPED = "cvdiag.queue_dropped"
    CVDIAG_METADATA_DROPPED = "cvdiag.metadata_dropped"


class EdgeHeaders(BaseModel):
    """The closed 9-key edge-header bag (spec §5). Absent → ``None``.

    ``model_config`` forbids extra keys so a forbidden/unknown edge header
    can never round-trip through this model.
    """

    model_config = ConfigDict(extra="forbid")

    cf_ray: Optional[str] = Field(default=None, alias="cf-ray")
    cf_mitigated: Optional[str] = Field(default=None, alias="cf-mitigated")
    cf_cache_status: Optional[str] = Field(default=None, alias="cf-cache-status")
    x_railway_edge: Optional[str] = Field(default=None, alias="x-railway-edge")
    x_railway_request_id: Optional[str] = Field(
        default=None, alias="x-railway-request-id"
    )
    x_hikari_trace: Optional[str] = Field(default=None, alias="x-hikari-trace")
    retry_after: Optional[str] = Field(default=None, alias="retry-after")
    via: Optional[str] = Field(default=None, alias="via")
    server: Optional[str] = Field(default=None, alias="server")


# ── Per-boundary metadata models (one per data-plane boundary, spec §5) ──
# Each forbids extra keys so an unknown metadata key is surfaced (caller
# stamps ``_metadata_dropped`` on the envelope).


class MetadataProbeStart(BaseModel):
    """Metadata for boundary ``probe.start`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    url: Optional[Any] = None
    viewport: Optional[Any] = None


class MetadataProbeNavigateComplete(BaseModel):
    """Metadata for boundary ``probe.navigate.complete`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    url: Optional[Any] = None
    nav_ms: Optional[Any] = None
    http_status: Optional[Any] = None


class MetadataProbeMessageSend(BaseModel):
    """Metadata for boundary ``probe.message.send`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    message_index: Optional[Any] = None
    char_count: Optional[Any] = None
    demo: Optional[Any] = None


class MetadataProbeDomContainerMount(BaseModel):
    """Metadata for boundary ``probe.dom.container.mount`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    delta_ms_from_start: Optional[Any] = None


class MetadataProbeDomFirsttoken(BaseModel):
    """Metadata for boundary ``probe.dom.firsttoken`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    delta_ms_from_start: Optional[Any] = None
    text_length: Optional[Any] = None


class MetadataProbeDomAlternate_content(BaseModel):
    """Metadata for boundary ``probe.dom.alternate_content`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    child_type_histogram: Optional[Any] = None


class MetadataProbeSseEvent(BaseModel):
    """Metadata for boundary ``probe.sse.event`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    event_type: Optional[Any] = None
    payload_size_bytes: Optional[Any] = None
    sequence_num: Optional[Any] = None


class MetadataProbeSseAborted(BaseModel):
    """Metadata for boundary ``probe.sse.aborted`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    termination_kind: Optional[Any] = None
    bytes_before_abort: Optional[Any] = None


class MetadataProbeNetworkError(BaseModel):
    """Metadata for boundary ``probe.network.error`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    url: Optional[Any] = None
    error_class: Optional[Any] = None
    response_status: Optional[Any] = None


class MetadataProbeNetworkResponse(BaseModel):
    """Metadata for boundary ``probe.network.response`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    url: Optional[Any] = None
    status: Optional[Any] = None
    content_length: Optional[Any] = None
    duration_ms: Optional[Any] = None


class MetadataProbeConsoleError(BaseModel):
    """Metadata for boundary ``probe.console.error`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    level: Optional[Any] = None
    message_scrubbed: Optional[Any] = None
    source_file: Optional[Any] = None
    line_col: Optional[Any] = None


class MetadataProbeExit(BaseModel):
    """Metadata for boundary ``probe.exit`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    terminal_outcome: Optional[Any] = None
    total_duration_ms: Optional[Any] = None
    sse_event_count: Optional[Any] = None
    first_token_delta_ms: Optional[Any] = None


class MetadataBackendRequestIngress(BaseModel):
    """Metadata for boundary ``backend.request.ingress`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    method: Optional[Any] = None
    path: Optional[Any] = None
    content_length: Optional[Any] = None


class MetadataBackendAgentEnter(BaseModel):
    """Metadata for boundary ``backend.agent.enter`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    agent_name: Optional[Any] = None
    model_id: Optional[Any] = None


class MetadataBackendLlmCallStart(BaseModel):
    """Metadata for boundary ``backend.llm.call.start`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    provider: Optional[Any] = None
    model: Optional[Any] = None
    prompt_token_count_estimate: Optional[Any] = None


class MetadataBackendLlmCallHeartbeat(BaseModel):
    """Metadata for boundary ``backend.llm.call.heartbeat`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    elapsed_ms_since_start: Optional[Any] = None


class MetadataBackendLlmCallResponse(BaseModel):
    """Metadata for boundary ``backend.llm.call.response`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    provider: Optional[Any] = None
    model: Optional[Any] = None
    response_token_count: Optional[Any] = None
    latency_ms: Optional[Any] = None
    error_class: Optional[Any] = None


class MetadataBackendSseFirst_byte(BaseModel):
    """Metadata for boundary ``backend.sse.first_byte`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    delta_ms_from_ingress: Optional[Any] = None


class MetadataBackendSseEvent(BaseModel):
    """Metadata for boundary ``backend.sse.event`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    event_type: Optional[Any] = None
    payload_size_bytes: Optional[Any] = None
    sequence_num: Optional[Any] = None


class MetadataBackendSseAborted(BaseModel):
    """Metadata for boundary ``backend.sse.aborted`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    termination_kind: Optional[Any] = None
    bytes_before_abort: Optional[Any] = None


class MetadataBackendAgentExit(BaseModel):
    """Metadata for boundary ``backend.agent.exit`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    terminal_outcome: Optional[Any] = None
    total_duration_ms: Optional[Any] = None


class MetadataBackendResponseComplete(BaseModel):
    """Metadata for boundary ``backend.response.complete`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    http_status: Optional[Any] = None
    content_length: Optional[Any] = None
    total_duration_ms: Optional[Any] = None
    sse_event_count: Optional[Any] = None


class MetadataBackendErrorCaught(BaseModel):
    """Metadata for boundary ``backend.error.caught`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    exception_type: Optional[Any] = None
    message_scrubbed: Optional[Any] = None
    stack_brief: Optional[Any] = None
    truncated: Optional[Any] = None


class MetadataAimockRequestIngress(BaseModel):
    """Metadata for boundary ``aimock.request.ingress`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    path: Optional[Any] = None
    content_length: Optional[Any] = None
    match_keys: Optional[Any] = None


class MetadataAimockMatchDecision(BaseModel):
    """Metadata for boundary ``aimock.match.decision`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    fixture_id: Optional[Any] = None
    match_score: Optional[Any] = None
    reject_reasons: Optional[Any] = None


class MetadataAimockResponseStart(BaseModel):
    """Metadata for boundary ``aimock.response.start`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    delta_ms_from_ingress: Optional[Any] = None


class MetadataAimockSseChunk(BaseModel):
    """Metadata for boundary ``aimock.sse.chunk`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    chunk_size_bytes: Optional[Any] = None
    sequence_num: Optional[Any] = None


class MetadataAimockResponseAborted(BaseModel):
    """Metadata for boundary ``aimock.response.aborted`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    termination_kind: Optional[Any] = None
    bytes_before_abort: Optional[Any] = None


class MetadataAimockResponseComplete(BaseModel):
    """Metadata for boundary ``aimock.response.complete`` (closed key set)."""

    model_config = ConfigDict(extra="forbid")

    http_status: Optional[Any] = None
    total_bytes: Optional[Any] = None
    total_duration_ms: Optional[Any] = None
    chunk_count: Optional[Any] = None


#: boundary literal → its closed metadata model (data-plane only).
BOUNDARY_METADATA_MODEL: dict[str, type[BaseModel]] = {
    "probe.start": MetadataProbeStart,
    "probe.navigate.complete": MetadataProbeNavigateComplete,
    "probe.message.send": MetadataProbeMessageSend,
    "probe.dom.container.mount": MetadataProbeDomContainerMount,
    "probe.dom.firsttoken": MetadataProbeDomFirsttoken,
    "probe.dom.alternate_content": MetadataProbeDomAlternate_content,
    "probe.sse.event": MetadataProbeSseEvent,
    "probe.sse.aborted": MetadataProbeSseAborted,
    "probe.network.error": MetadataProbeNetworkError,
    "probe.network.response": MetadataProbeNetworkResponse,
    "probe.console.error": MetadataProbeConsoleError,
    "probe.exit": MetadataProbeExit,
    "backend.request.ingress": MetadataBackendRequestIngress,
    "backend.agent.enter": MetadataBackendAgentEnter,
    "backend.llm.call.start": MetadataBackendLlmCallStart,
    "backend.llm.call.heartbeat": MetadataBackendLlmCallHeartbeat,
    "backend.llm.call.response": MetadataBackendLlmCallResponse,
    "backend.sse.first_byte": MetadataBackendSseFirst_byte,
    "backend.sse.event": MetadataBackendSseEvent,
    "backend.sse.aborted": MetadataBackendSseAborted,
    "backend.agent.exit": MetadataBackendAgentExit,
    "backend.response.complete": MetadataBackendResponseComplete,
    "backend.error.caught": MetadataBackendErrorCaught,
    "aimock.request.ingress": MetadataAimockRequestIngress,
    "aimock.match.decision": MetadataAimockMatchDecision,
    "aimock.response.start": MetadataAimockResponseStart,
    "aimock.sse.chunk": MetadataAimockSseChunk,
    "aimock.response.aborted": MetadataAimockResponseAborted,
    "aimock.response.complete": MetadataAimockResponseComplete,
}


class CvdiagEnvelope(BaseModel):
    """The CVDIAG flap-observability envelope (spec §5).

    Unknown TOP-LEVEL keys are dropped (closed-world) and the drop is
    recorded via ``_metadata_dropped``; the ``metadata`` bag itself is
    free-form here (per-boundary closed validation is applied separately
    via ``BOUNDARY_METADATA_MODEL`` so a metadata-only unknown key does not
    reject the whole envelope, it just stamps ``_metadata_dropped``).
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    schema_version: int = SCHEMA_VERSION
    test_id: str = Field(pattern=TEST_ID_PATTERN)
    trace_id: str
    span_id: str = Field(pattern=SPAN_ID_PATTERN)
    parent_span_id: Optional[str] = None
    layer: CvdiagLayer
    boundary: CvdiagBoundary
    slug: str = Field(pattern=SLUG_PATTERN)
    demo: str
    ts: str
    mono_ns: int
    duration_ms: Optional[int] = None
    outcome: CvdiagOutcome
    edge_headers: EdgeHeaders
    metadata: dict[str, Any] = Field(default_factory=dict)
    metadata_dropped: bool = Field(default=False, alias="_metadata_dropped")
    truncated: bool = Field(default=False, alias="_truncated")

    @model_validator(mode="before")
    @classmethod
    def _stamp_dropped_unknown_keys(cls, data: Any) -> Any:
        """Stamp ``_metadata_dropped`` when unknown top-level OR metadata keys
        are present, then strip the unknown top-level keys (closed-world).
        """
        if not isinstance(data, dict):
            return data
        known = set(cls.model_fields.keys())
        aliases = {f.alias for f in cls.model_fields.values() if f.alias is not None}
        allowed = known | aliases
        dropped = False
        cleaned: dict[str, Any] = {}
        for key, value in data.items():
            if key in allowed:
                cleaned[key] = value
            else:
                dropped = True  # unknown top-level key → drop + stamp
        # Unknown metadata keys (against the per-boundary closed model).
        boundary = cleaned.get("boundary")
        meta = cleaned.get("metadata")
        if isinstance(boundary, str) and isinstance(meta, dict):
            model = BOUNDARY_METADATA_MODEL.get(boundary)
            if model is not None:
                allowed_meta = set(model.model_fields.keys())
                if any(mk not in allowed_meta for mk in meta):
                    dropped = True
        if dropped:
            cleaned["_metadata_dropped"] = True
        return cleaned
