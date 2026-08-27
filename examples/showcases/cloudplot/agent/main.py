"""
CloudPlot Agent - AI-powered cloud infrastructure architect.

This agent helps design, validate, and estimate costs for simulated AWS
infrastructure rendered as resource cards in the frontend workspace.
"""

from __future__ import annotations

import copy
import json
import logging
import time
import uuid
from collections.abc import Mapping
from typing import Annotated, Literal, NotRequired, TypedDict

from copilotkit import CopilotKitState
from langchain.tools import tool
from langchain_core.messages import SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command
from pydantic import BaseModel, ConfigDict, Field, ValidationError

LOGGER = logging.getLogger("cloudplot.agent")

# -----------------------------------------------------------------------------
# Type Definitions
# -----------------------------------------------------------------------------

ResourceType = Literal["s3", "ec2", "rds", "lambda", "vpc", "alb"]
StatusType = Literal["healthy", "warning", "error", "stopped"]
AgentStatusType = Literal["idle", "designing", "validating"]
TierType = Literal["network", "frontend", "compute", "data", "storage"]


class StrictResourceConfig(BaseModel):
    """Reject coercion and unknown model-generated configuration fields."""

    model_config = ConfigDict(extra="forbid", strict=True)


class S3ResourceConfig(StrictResourceConfig):
    bucket_name: str
    access_level: Literal["public", "private"]
    versioning: bool


class EC2ResourceConfig(StrictResourceConfig):
    instance_type: str
    ami: str
    name: str
    security_group: str | None = None


class RDSResourceConfig(StrictResourceConfig):
    engine: str
    instance_class: str
    multi_az: bool
    encryption: bool
    name: str


class LambdaResourceConfig(StrictResourceConfig):
    runtime: str
    memory: int
    timeout: int
    name: str


class VPCResourceConfig(StrictResourceConfig):
    cidr_block: str
    subnets: list[str]
    name: str


class ALBResourceConfig(StrictResourceConfig):
    listeners: list[int]
    target_groups: list[str]
    name: str


class S3ResourceUpdate(StrictResourceConfig):
    resource_type: Literal["s3"]
    bucket_name: str | None = None
    access_level: Literal["public", "private"] | None = None
    versioning: bool | None = None


class EC2ResourceUpdate(StrictResourceConfig):
    resource_type: Literal["ec2"]
    instance_type: str | None = None
    ami: str | None = None
    name: str | None = None
    security_group: str | None = None


class RDSResourceUpdate(StrictResourceConfig):
    resource_type: Literal["rds"]
    engine: str | None = None
    instance_class: str | None = None
    multi_az: bool | None = None
    encryption: bool | None = None
    name: str | None = None


class LambdaResourceUpdate(StrictResourceConfig):
    resource_type: Literal["lambda"]
    runtime: str | None = None
    memory: int | None = None
    timeout: int | None = None
    name: str | None = None


class VPCResourceUpdate(StrictResourceConfig):
    resource_type: Literal["vpc"]
    cidr_block: str | None = None
    subnets: list[str] | None = None
    name: str | None = None


class ALBResourceUpdate(StrictResourceConfig):
    resource_type: Literal["alb"]
    listeners: list[int] | None = None
    target_groups: list[str] | None = None
    name: str | None = None


ResourceUpdate = Annotated[
    S3ResourceUpdate
    | EC2ResourceUpdate
    | RDSResourceUpdate
    | LambdaResourceUpdate
    | VPCResourceUpdate
    | ALBResourceUpdate,
    Field(discriminator="resource_type"),
]


class UpdateResourceArgs(BaseModel):
    resource_id: str
    update: ResourceUpdate


RESOURCE_CONFIG_MODELS: dict[str, type[StrictResourceConfig]] = {
    "s3": S3ResourceConfig,
    "ec2": EC2ResourceConfig,
    "rds": RDSResourceConfig,
    "lambda": LambdaResourceConfig,
    "vpc": VPCResourceConfig,
    "alb": ALBResourceConfig,
}

# Tier mapping by resource type (for automatic assignment)
RESOURCE_TIER_MAP: dict[ResourceType, TierType] = {
    "vpc": "network",
    "alb": "frontend",
    "ec2": "compute",
    "lambda": "compute",
    "rds": "data",
    "s3": "storage",
}


class NodeData(TypedDict, total=False):
    """AWS resource node data."""

    id: str
    type: ResourceType
    position: dict  # {x: float, y: float}
    config: dict
    status: StatusType
    tier: TierType
    parentId: str  # ID of parent VPC for contained resources


class EdgeData(TypedDict):
    """Connection between resources."""

    id: str
    source: str
    target: str


class ValidationResult(TypedDict):
    """Validation error or warning."""

    level: Literal["error", "warning"]
    message: str
    node_id: str


class ThoughtLogEntry(TypedDict):
    """Agent thinking log entry."""

    timestamp: float
    node: str
    message: str
    type: Literal["info", "warning", "success", "error"]


class AppliedToolResult(TypedDict):
    """Copied infrastructure state plus optional model-visible rejection detail."""

    nodes: list[NodeData]
    edges: list[EdgeData]
    logs: list[ThoughtLogEntry]
    tool_error: NotRequired[str]


# -----------------------------------------------------------------------------
# Agent State
# -----------------------------------------------------------------------------


class AgentState(CopilotKitState):
    """
    CloudPlot agent state - synced with frontend via CopilotKit.

    Attributes:
        nodes: AWS resource nodes on the canvas
        edges: Connections between resources
        logs: Agent thinking/activity log
        cost: Estimated monthly cost in USD
        status: Current agent status
        validation_errors: List of validation issues
        copilotkit: CopilotKit frontend action metadata
    """

    nodes: list[NodeData]
    edges: list[EdgeData]
    logs: list[ThoughtLogEntry]
    cost: float
    status: AgentStatusType
    validation_errors: list[ValidationResult]


# -----------------------------------------------------------------------------
# Pricing (mock AWS pricing)
# -----------------------------------------------------------------------------

RESOURCE_PRICING = {
    "s3": 2.30,  # per month, 100GB assumed
    "ec2": {
        "t3.micro": 7.59,
        "t3.small": 15.18,
        "t3.medium": 30.37,
        "t3.large": 60.74,
        "default": 30.37,
    },
    "rds": {
        "db.t3.micro": 12.41,
        "db.t3.small": 24.82,
        "db.t3.medium": 49.64,
        "default": 24.82,
    },
    "lambda": 0.20,  # per month estimate
    "vpc": 0.00,  # VPC is free, NAT gateway would cost
    "alb": 16.43,  # per month
}


def calculate_resource_cost(node: NodeData) -> float:
    """Calculate monthly cost for a single resource."""
    resource_type = node["type"]
    config = node.get("config", {})

    if resource_type == "s3":
        return RESOURCE_PRICING["s3"]
    elif resource_type == "ec2":
        instance_type = config.get("instance_type", "default")
        return RESOURCE_PRICING["ec2"].get(
            instance_type, RESOURCE_PRICING["ec2"]["default"]
        )
    elif resource_type == "rds":
        instance_class = config.get("instance_class", "default")
        return RESOURCE_PRICING["rds"].get(
            instance_class, RESOURCE_PRICING["rds"]["default"]
        )
    elif resource_type == "lambda":
        return RESOURCE_PRICING["lambda"]
    elif resource_type == "vpc":
        return RESOURCE_PRICING["vpc"]
    elif resource_type == "alb":
        return RESOURCE_PRICING["alb"]
    return 0.0


# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------


def log_thought(
    state: AgentState,
    node_name: str,
    message: str,
    log_type: Literal["info", "warning", "success", "error"] = "info",
) -> ThoughtLogEntry:
    """Create a thought log entry."""
    return {
        "timestamp": time.time(),
        "node": node_name,
        "message": message,
        "type": log_type,
    }


def generate_position(existing_nodes: list[NodeData]) -> dict:
    """Generate a position for a new node based on existing nodes."""
    if not existing_nodes:
        return {"x": 100, "y": 100}

    # Find the rightmost node and place new one to the right
    max_x = max(n.get("position", {}).get("x", 0) for n in existing_nodes)
    avg_y = sum(n.get("position", {}).get("y", 200) for n in existing_nodes) / len(
        existing_nodes
    )

    return {"x": max_x + 250, "y": avg_y}


def generate_state_summary(nodes: list[NodeData], edges: list[EdgeData]) -> str:
    """Generate a summary of current infrastructure state for tool responses."""
    if not nodes:
        return "\n[Current state: No resources exist. Workspace is empty.]"

    nodes_list = ", ".join([f"{n['type']}({n['id']})" for n in nodes])
    edges_list = (
        ", ".join([f"{e['source']}->{e['target']}" for e in edges]) if edges else "none"
    )

    return f"\n[Current state: Resources: {nodes_list}. Connections: {edges_list}]"


def format_validation_error(error: ValidationError) -> str:
    """Return a compact model-visible validation failure without a traceback."""

    details = []
    for item in error.errors(include_url=False, include_context=False):
        location = ".".join(str(part) for part in item["loc"])
        details.append(f"{location}: {item['msg']}")
    return "Invalid resource configuration: " + "; ".join(details)


# -----------------------------------------------------------------------------
# Backend Tools
# -----------------------------------------------------------------------------


@tool
def add_resource(
    resource_type: str,
    name: str,
    resource_config: dict | None = None,
    vpc_id: str | None = None,
) -> dict:
    """
    Add a new AWS resource to the infrastructure diagram.

    Args:
        resource_type: Type of resource (s3, ec2, rds, lambda, vpc, alb)
        name: Display name for the resource
        resource_config: Resource-specific configuration
        vpc_id: Optional ID of parent VPC to place this resource inside

    Returns:
        The created node data
    """
    if resource_type not in ["s3", "ec2", "rds", "lambda", "vpc", "alb"]:
        return {"error": f"Invalid resource type: {resource_type}"}

    node_id = f"{resource_type}-{uuid.uuid4().hex[:8]}"

    # Default configs per type
    default_configs = {
        "s3": {"bucket_name": name, "access_level": "private", "versioning": False},
        "ec2": {"instance_type": "t3.medium", "ami": "ami-12345678", "name": name},
        "rds": {
            "engine": "postgresql",
            "instance_class": "db.t3.micro",
            "multi_az": False,
            "encryption": True,
            "name": name,
        },
        "lambda": {"runtime": "python3.12", "memory": 128, "timeout": 30, "name": name},
        "vpc": {"cidr_block": "10.0.0.0/16", "subnets": [], "name": name},
        "alb": {"listeners": [80, 443], "target_groups": [], "name": name},
    }

    merged_config = {
        **default_configs.get(resource_type, {}),
        **(resource_config or {}),
    }
    try:
        validated_config = RESOURCE_CONFIG_MODELS[resource_type].model_validate(
            merged_config
        )
    except ValidationError as error:
        return {"success": False, "error": format_validation_error(error)}

    result = {
        "id": node_id,
        "type": resource_type,
        "config": validated_config.model_dump(exclude_none=True),
        "status": "healthy",
        "tier": RESOURCE_TIER_MAP.get(resource_type, "compute"),
    }

    # If vpc_id provided, include parentId for containment
    if vpc_id:
        result["parentId"] = vpc_id

    return result


@tool
def connect_resources(source_id: str, target_id: str, label: str = "") -> dict:
    """
    Connect two resources with a directional edge.

    Args:
        source_id: ID of the source resource
        target_id: ID of the target resource
        label: Optional label for the connection

    Returns:
        The created edge data
    """
    edge_id = f"edge-{uuid.uuid4().hex[:8]}"
    return {
        "id": edge_id,
        "source": source_id,
        "target": target_id,
        "label": label,
    }


@tool
def remove_resource(resource_id: str) -> dict:
    """
    Remove a resource from the infrastructure diagram.

    Args:
        resource_id: ID of the resource to remove

    Returns:
        Confirmation of removal
    """
    return {"removed": resource_id, "success": True}


@tool(args_schema=UpdateResourceArgs)
def update_resource(resource_id: str, update: ResourceUpdate) -> dict:
    """
    Update an existing resource's configuration.

    Args:
        resource_id: ID of the resource to update
        update: Typed resource-specific configuration values to merge

    Returns:
        Updated resource info
    """
    return {
        "updated": resource_id,
        "resource_type": update.resource_type,
        "config": update.model_dump(exclude={"resource_type"}, exclude_none=True),
        "success": True,
    }


@tool
def move_to_vpc(resource_id: str, vpc_id: str | None = None) -> dict:
    """
    Move a resource into or out of a VPC.

    Args:
        resource_id: ID of the resource to move (ec2, rds, lambda, alb)
        vpc_id: ID of the target VPC, or None/empty to remove from VPC

    Returns:
        Move operation result
    """
    return {"moved": resource_id, "vpc_id": vpc_id, "success": True}


backend_tools = [
    add_resource,
    connect_resources,
    remove_resource,
    update_resource,
    move_to_vpc,
]

backend_tool_names = [t.name for t in backend_tools]


# -----------------------------------------------------------------------------
# Graph Nodes
# -----------------------------------------------------------------------------


def create_architect_model() -> ChatOpenAI:
    """Create the architect model without sampling or output truncation overrides."""

    return ChatOpenAI(model="gpt-5.1")


def frontend_tools_from_state(state: AgentState) -> list[dict]:
    """Return V2 frontend actions supplied by the CopilotKit AG-UI middleware."""

    copilotkit_state = state.get("copilotkit", {})
    actions = copilotkit_state.get("actions", [])
    return actions if isinstance(actions, list) else []


async def architect_node(state: AgentState, config: RunnableConfig) -> Command[str]:
    """
    Main architect node - LLM with tools for designing infrastructure.
    Uses ReAct pattern to iteratively build the diagram.
    """
    model = create_architect_model()
    frontend_tools = frontend_tools_from_state(state)

    # Bind all tools
    model_with_tools = model.bind_tools(
        [
            *frontend_tools,
            *backend_tools,
        ],
        parallel_tool_calls=False,
    )

    # Build context about current state
    current_nodes = state.get("nodes", [])
    current_edges = state.get("edges", [])
    current_cost = state.get("cost", 0)
    validation_errors = state.get("validation_errors", [])

    nodes_summary = (
        ", ".join([f"{n['type']}({n['id']})" for n in current_nodes])
        if current_nodes
        else "none"
    )
    edges_summary = (
        ", ".join([f"{e['source']}->{e['target']}" for e in current_edges])
        if current_edges
        else "none"
    )
    errors_summary = (
        "\n".join([f"- {e['level']}: {e['message']}" for e in validation_errors])
        if validation_errors
        else "none"
    )

    system_prompt = f"""You are CloudPlot, a Senior Cloud Architect AI assistant.
You help users design simulated AWS infrastructure in a visual workspace.

You are a senior architect. Make decisions confidently using AWS best practices.
Propose complete solutions without asking for user preferences.
Only ask questions when the request is genuinely ambiguous.

CURRENT INFRASTRUCTURE STATE:
- Resources: {nodes_summary}
- Connections: {edges_summary}
- Estimated monthly cost: ${current_cost:.2f}
- Validation issues: {errors_summary}

AVAILABLE TOOLS:
- add_resource: Add S3, EC2, RDS, Lambda, VPC, or ALB resources. Use vpc_id parameter to place EC2, RDS, Lambda inside a VPC.
- connect_resources: Create connections between resources
- remove_resource: Remove a resource
- update_resource: Modify resource configuration
- move_to_vpc: Move an existing resource into a VPC (use this to relocate resources)
- approveDeployment: Ask the operator to approve or reject a simulated deployment. Call this when the user asks to deploy or approve the proposed architecture. Include the affected resource names, estimated monthly cost impact, and a risk level.

CRITICAL: CloudPlot is a simulation only. Never claim that approval creates or deploys AWS resources.

GUIDELINES:
1. When adding resources, use descriptive names
2. Connect resources logically (e.g., ALB -> EC2 -> RDS)
3. Create COMPLETE connection topologies: if an ALB serves multiple EC2 instances, connect it to ALL of them. If multiple EC2 instances need database access, connect EACH one to the RDS. Never leave resources partially connected.
4. Place compute (EC2, Lambda) and data (RDS) resources inside VPCs when appropriate - use vpc_id parameter
5. S3 is a global service and should NOT be placed inside VPCs
6. Consider security: private subnets for RDS, security groups for EC2
7. Warn about cost implications for expensive resources
8. Do not explain your actions. The UI shows what happened visually.
9. Only speak when there's an error or the user asks a question.

Only communicate errors or answers to direct questions."""

    system_message = SystemMessage(content=system_prompt)

    response = await model_with_tools.ainvoke(
        [system_message, *state["messages"]],
        config,
    )

    # Check if we need to route to tool node
    tool_calls = getattr(response, "tool_calls", None)
    if tool_calls:
        for tc in tool_calls:
            if tc.get("name") in backend_tool_names:
                # Create thought log
                new_log = log_thought(
                    state,
                    "architect",
                    f"Calling tool: {tc.get('name')}",
                    "info",
                )
                return Command(
                    goto="tool_node",
                    update={
                        "messages": [response],
                        "status": "designing",
                        "logs": [*state.get("logs", []), new_log],
                    },
                )

        frontend_tool_names = {
            tool.get("name")
            for tool in frontend_tools
            if isinstance(tool, dict) and isinstance(tool.get("name"), str)
        }
        if any(tc.get("name") in frontend_tool_names for tc in tool_calls):
            return Command(
                goto=END,
                update={
                    "messages": [response],
                    "status": "idle",
                },
            )

    # No backend tools called, end turn
    return Command(
        goto="validate_node",
        update={
            "messages": [response],
            "status": "validating",
        },
    )


def parse_tool_result(content: object) -> dict | None:
    """Decode a structured tool result without rewriting Python repr strings."""

    if isinstance(content, Mapping):
        return dict(content)
    if not isinstance(content, str):
        LOGGER.warning("Unsupported tool result type: %s", type(content).__name__)
        return None

    try:
        decoded = json.loads(content)
    except json.JSONDecodeError as error:
        LOGGER.warning("Could not parse tool result as JSON: %s", error)
        return None

    if not isinstance(decoded, dict):
        LOGGER.warning(
            "Tool result JSON must be an object, got %s", type(decoded).__name__
        )
        return None
    return decoded


def apply_tool_result(state: AgentState, data: Mapping) -> AppliedToolResult:
    """Apply one backend tool result to a copied infrastructure snapshot."""

    new_nodes = copy.deepcopy(state.get("nodes", []))
    new_edges = copy.deepcopy(state.get("edges", []))
    new_logs = list(state.get("logs", []))
    node_ids = {node["id"] for node in new_nodes}

    if data.get("success") is False and isinstance(data.get("error"), str):
        error_message = data["error"]
        new_logs.append(log_thought(state, "tool_node", error_message, "error"))
        return {
            "nodes": new_nodes,
            "edges": new_edges,
            "logs": new_logs,
            "tool_error": error_message,
        }

    if "id" in data and "type" in data:
        parent_id = data.get("parentId")
        if parent_id and not any(
            node["id"] == parent_id and node["type"] == "vpc" for node in new_nodes
        ):
            error_message = f"Invalid vpc_id: {parent_id} does not exist"
            new_logs.append(
                log_thought(
                    state,
                    "tool_node",
                    error_message,
                    "error",
                )
            )
            return {
                "nodes": new_nodes,
                "edges": new_edges,
                "logs": new_logs,
                "tool_error": error_message,
            }

        resource_type = data["type"]
        new_node = {
            "id": data["id"],
            "type": resource_type,
            "position": {"x": 0, "y": 0},
            "config": data.get("config", {}),
            "status": data.get("status", "healthy"),
            "tier": data.get("tier", RESOURCE_TIER_MAP.get(resource_type, "compute")),
        }
        if parent_id:
            new_node["parentId"] = parent_id
        new_nodes.append(new_node)
        location = f" inside VPC {parent_id}" if parent_id else ""
        new_logs.append(
            log_thought(
                state,
                "tool_node",
                f"Added {resource_type} resource: {data['id']}{location}",
                "success",
            )
        )
    elif "source" in data and "target" in data:
        missing_ids = [
            resource_id
            for resource_id in (data["source"], data["target"])
            if resource_id not in node_ids
        ]
        if missing_ids:
            error_message = (
                f"Cannot connect resources: {', '.join(missing_ids)} does not exist"
            )
            new_logs.append(
                log_thought(
                    state,
                    "tool_node",
                    error_message,
                    "warning",
                )
            )
            return {
                "nodes": new_nodes,
                "edges": new_edges,
                "logs": new_logs,
                "tool_error": error_message,
            }

        new_edges.append(
            {"id": data["id"], "source": data["source"], "target": data["target"]}
        )
        new_logs.append(
            log_thought(
                state,
                "tool_node",
                f"Connected {data['source']} -> {data['target']}",
                "success",
            )
        )
    elif "removed" in data:
        resource_id = data["removed"]
        if any(node["id"] == resource_id for node in new_nodes):
            new_nodes = [node for node in new_nodes if node["id"] != resource_id]
            new_edges = [
                edge
                for edge in new_edges
                if edge["source"] != resource_id and edge["target"] != resource_id
            ]
            new_logs.append(
                log_thought(state, "tool_node", f"Removed resource: {resource_id}")
            )
        else:
            new_logs.append(
                log_thought(
                    state,
                    "tool_node",
                    f"Resource {resource_id} not found (already removed)",
                    "warning",
                )
            )
    elif "updated" in data:
        resource_id = data["updated"]
        if resource_id not in node_ids:
            error_message = f"Cannot update {resource_id}: resource does not exist"
            new_logs.append(
                log_thought(
                    state,
                    "tool_node",
                    error_message,
                    "warning",
                )
            )
            return {
                "nodes": new_nodes,
                "edges": new_edges,
                "logs": new_logs,
                "tool_error": error_message,
            }

        actual_type = next(
            node["type"] for node in new_nodes if node["id"] == resource_id
        )
        requested_type = data.get("resource_type")
        if requested_type != actual_type:
            error_message = (
                f"Cannot update {resource_id}: resource type is {actual_type}, "
                f"not {requested_type}"
            )
            new_logs.append(
                log_thought(state, "tool_node", error_message, "error")
            )
            return {
                "nodes": new_nodes,
                "edges": new_edges,
                "logs": new_logs,
                "tool_error": error_message,
            }

        new_config = data.get("config", {})
        for node in new_nodes:
            if node["id"] == resource_id:
                node["config"] = {**node.get("config", {}), **new_config}
                break
        new_logs.append(
            log_thought(state, "tool_node", f"Updated resource: {resource_id}")
        )
    elif "moved" in data:
        resource_id = data["moved"]
        target_vpc_id = data.get("vpc_id")
        if resource_id not in node_ids:
            error_message = f"Cannot move {resource_id}: resource does not exist"
            new_logs.append(
                log_thought(
                    state,
                    "tool_node",
                    error_message,
                    "warning",
                )
            )
            return {
                "nodes": new_nodes,
                "edges": new_edges,
                "logs": new_logs,
                "tool_error": error_message,
            }

        if target_vpc_id and not any(
            node["id"] == target_vpc_id and node["type"] == "vpc" for node in new_nodes
        ):
            error_message = (
                f"Cannot move {resource_id}: VPC {target_vpc_id} does not exist"
            )
            new_logs.append(
                log_thought(
                    state,
                    "tool_node",
                    error_message,
                    "error",
                )
            )
            return {
                "nodes": new_nodes,
                "edges": new_edges,
                "logs": new_logs,
                "tool_error": error_message,
            }

        for node in new_nodes:
            if node["id"] != resource_id:
                continue
            if target_vpc_id:
                node["parentId"] = target_vpc_id
                message = f"Moved {resource_id} into VPC {target_vpc_id}"
                log_type = "success"
            else:
                node.pop("parentId", None)
                message = f"Removed {resource_id} from VPC"
                log_type = "info"
            new_logs.append(log_thought(state, "tool_node", message, log_type))
            break

    return {"nodes": new_nodes, "edges": new_edges, "logs": new_logs}


async def tool_node_wrapper(state: AgentState, config: RunnableConfig) -> Command[str]:
    """Run backend tools, then apply their structured results to agent state."""

    result = await ToolNode(tools=backend_tools).ainvoke(state, config)
    messages = result.get("messages", [])
    updated = {
        "nodes": copy.deepcopy(state.get("nodes", [])),
        "edges": copy.deepcopy(state.get("edges", [])),
        "logs": list(state.get("logs", [])),
    }
    tool_errors: list[str | None] = []

    for message in messages:
        if getattr(message, "status", None) == "error":
            error_message = (
                f"Invalid arguments for {getattr(message, 'name', 'backend tool')}: "
                f"{getattr(message, 'content', 'validation failed')}"
            )
            updated["logs"].append(
                log_thought(state, "tool_node", error_message, "error")
            )
            tool_errors.append(error_message)
            continue

        data = parse_tool_result(getattr(message, "content", message))
        if data is None:
            error_message = "Malformed backend tool result: expected a JSON object"
            updated["logs"].append(
                log_thought(
                    state,
                    "tool_node",
                    error_message,
                    "error",
                )
            )
            tool_errors.append(error_message)
            continue
        applied = apply_tool_result({**state, **updated}, data)
        tool_errors.append(applied.get("tool_error"))
        updated = {
            "nodes": applied["nodes"],
            "edges": applied["edges"],
            "logs": applied["logs"],
        }

    updated_cost = sum(calculate_resource_cost(node) for node in updated["nodes"])

    # Append current state summary to tool messages so agent knows what exists
    state_summary = generate_state_summary(updated["nodes"], updated["edges"])
    enriched_messages = []
    for msg, tool_error in zip(messages, tool_errors, strict=True):
        if tool_error:
            content = json.dumps({"success": False, "error": tool_error})
        elif hasattr(msg, "content") and isinstance(msg.content, str):
            content = msg.content
        else:
            enriched_messages.append(msg)
            continue

        if hasattr(msg, "content"):
            enriched_msg = ToolMessage(
                content=content + state_summary,
                tool_call_id=getattr(msg, "tool_call_id", ""),
                name=getattr(msg, "name", None),
            )
            enriched_messages.append(enriched_msg)

    return Command(
        goto="architect_node",
        update={
            "messages": enriched_messages,
            "nodes": updated["nodes"],
            "edges": updated["edges"],
            "logs": updated["logs"],
            "cost": updated_cost,
        },
    )


async def validate_node(state: AgentState, config: RunnableConfig) -> Command[str]:
    """
    Validate the infrastructure design.
    Checks for meaningful issues: orphaned nodes, missing connections, explicit misconfigurations.
    """
    nodes = state.get("nodes", [])
    edges = state.get("edges", [])
    errors: list[ValidationResult] = []

    new_logs = list(state.get("logs", []))
    new_logs.append(
        log_thought(state, "validate", "Running validation checks...", "info")
    )

    # Build a set of connected node IDs
    connected_nodes = set()
    for edge in edges:
        connected_nodes.add(edge["source"])
        connected_nodes.add(edge["target"])

    # Build a set of VPC IDs for containment validation
    vpc_ids = {node["id"] for node in nodes if node["type"] == "vpc"}

    for node in nodes:
        node_id = node["id"]
        node_type = node["type"]
        node_config = node.get("config", {})

        # S3 validations - only warn about explicit public access
        if node_type == "s3":
            if node_config.get("access_level") == "public":
                errors.append(
                    {
                        "level": "warning",
                        "message": f"S3 bucket {node_id} is publicly accessible",
                        "node_id": node_id,
                    }
                )

        # RDS validations - encryption explicitly disabled, or orphaned
        elif node_type == "rds":
            # Only warn if encryption is explicitly set to False
            if node_config.get("encryption") is False:
                errors.append(
                    {
                        "level": "warning",
                        "message": f"RDS instance {node_id} has encryption disabled",
                        "node_id": node_id,
                    }
                )
            # Orphaned RDS (not connected to anything)
            if node_id not in connected_nodes:
                errors.append(
                    {
                        "level": "warning",
                        "message": f"RDS instance {node_id} is not connected to any resource",
                        "node_id": node_id,
                    }
                )

        # EC2/Lambda orphan check - should be connected or inside a VPC
        elif node_type in ("ec2", "lambda"):
            parent_id = node.get("parentId")
            if node_id not in connected_nodes and not parent_id:
                errors.append(
                    {
                        "level": "warning",
                        "message": f"{node_type.upper()} {node_id} is orphaned (no connections or VPC)",
                        "node_id": node_id,
                    }
                )

        # Lambda memory validation (only if explicitly set too high)
        if node_type == "lambda":
            memory = node_config.get("memory", 128)
            if memory > 3008:
                errors.append(
                    {
                        "level": "warning",
                        "message": f"Lambda {node_id} has high memory ({memory}MB) - check if needed",
                        "node_id": node_id,
                    }
                )

        # Validate parentId references exist
        parent_id = node.get("parentId")
        if parent_id and parent_id not in vpc_ids:
            errors.append(
                {
                    "level": "error",
                    "message": f"Resource {node_id} references non-existent VPC: {parent_id}",
                    "node_id": node_id,
                }
            )

    # Log validation results
    if errors:
        new_logs.append(
            log_thought(
                state,
                "validate",
                f"Found {len(errors)} validation issue(s)",
                "warning",
            )
        )
    else:
        new_logs.append(
            log_thought(state, "validate", "All validation checks passed!", "success")
        )

    return Command(
        goto="cost_estimator_node",
        update={
            "validation_errors": errors,
            "logs": new_logs,
        },
    )


async def cost_estimator_node(
    state: AgentState, config: RunnableConfig
) -> Command[str]:
    """
    Calculate the estimated monthly cost for all resources.
    """
    nodes = state.get("nodes", [])
    total_cost = sum(calculate_resource_cost(node) for node in nodes)

    new_logs = list(state.get("logs", []))
    new_logs.append(
        log_thought(
            state,
            "cost_estimator",
            f"Estimated monthly cost: ${total_cost:.2f}",
            "info",
        )
    )

    return Command(
        goto=END,
        update={
            "cost": total_cost,
            "status": "idle",
            "logs": new_logs,
        },
    )


# -----------------------------------------------------------------------------
# Graph Definition
# -----------------------------------------------------------------------------

workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("architect_node", architect_node)
workflow.add_node("tool_node", tool_node_wrapper)
workflow.add_node("validate_node", validate_node)
workflow.add_node("cost_estimator_node", cost_estimator_node)

# Set entry point
workflow.set_entry_point("architect_node")

# Edges are handled via Command returns in each node

# MemorySaver preserves threads only for the lifetime of this agent process.
# Railway restarts discard it; durable persistence requires an external
# checkpointer and is intentionally outside this simulation demo's scope.
graph = workflow.compile(checkpointer=MemorySaver()).with_config(recursion_limit=75)
