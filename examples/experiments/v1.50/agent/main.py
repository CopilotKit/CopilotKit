"""
CloudPlot Agent - AI-powered cloud infrastructure architect.

This agent helps design, validate, and estimate costs for AWS infrastructure
using a visual canvas approach with React Flow on the frontend.
"""

import time
import uuid
from typing import Any, List, Literal, TypedDict

from langchain.tools import tool
from langchain_core.messages import BaseMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt

# -----------------------------------------------------------------------------
# Type Definitions
# -----------------------------------------------------------------------------

ResourceType = Literal["s3", "ec2", "rds", "lambda", "vpc", "alb"]
StatusType = Literal["healthy", "warning", "error", "stopped"]
AgentStatusType = Literal["idle", "designing", "validating", "deploying"]
TierType = Literal["network", "frontend", "compute", "data", "storage"]

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


# -----------------------------------------------------------------------------
# Agent State
# -----------------------------------------------------------------------------


class AgentState(MessagesState):
    """
    CloudPlot agent state - synced with frontend via CopilotKit.

    Attributes:
        nodes: AWS resource nodes on the canvas
        edges: Connections between resources
        logs: Agent thinking/activity log
        cost: Estimated monthly cost in USD
        status: Current agent status
        validation_errors: List of validation issues
        tools: CopilotKit frontend tools
    """

    nodes: List[NodeData]
    edges: List[EdgeData]
    logs: List[ThoughtLogEntry]
    cost: float
    status: AgentStatusType
    validation_errors: List[ValidationResult]
    tools: List[Any]


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


def generate_position(existing_nodes: List[NodeData]) -> dict:
    """Generate a position for a new node based on existing nodes."""
    if not existing_nodes:
        return {"x": 100, "y": 100}

    # Find the rightmost node and place new one to the right
    max_x = max(n.get("position", {}).get("x", 0) for n in existing_nodes)
    avg_y = sum(n.get("position", {}).get("y", 200) for n in existing_nodes) / len(
        existing_nodes
    )

    return {"x": max_x + 250, "y": avg_y}


def generate_state_summary(nodes: List[NodeData], edges: List[EdgeData]) -> str:
    """Generate a summary of current infrastructure state for tool responses."""
    if not nodes:
        return "\n[Current state: No resources exist. Canvas is empty.]"

    nodes_list = ", ".join([f"{n['type']}({n['id']})" for n in nodes])
    edges_list = ", ".join([f"{e['source']}->{e['target']}" for e in edges]) if edges else "none"

    return f"\n[Current state: Resources: {nodes_list}. Connections: {edges_list}]"


# -----------------------------------------------------------------------------
# Backend Tools
# -----------------------------------------------------------------------------


@tool
def add_resource(
    resource_type: str, name: str, config: dict = None, vpc_id: str = None
) -> dict:
    """
    Add a new AWS resource to the infrastructure diagram.

    Args:
        resource_type: Type of resource (s3, ec2, rds, lambda, vpc, alb)
        name: Display name for the resource
        config: Resource-specific configuration
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

    merged_config = {**default_configs.get(resource_type, {}), **(config or {})}

    result = {
        "id": node_id,
        "type": resource_type,
        "config": merged_config,
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


@tool
def update_resource(resource_id: str, config: dict = None) -> dict:
    """
    Update an existing resource's configuration.

    Args:
        resource_id: ID of the resource to update
        config: New configuration values to merge

    Returns:
        Updated resource info
    """
    if config is None:
        return {"error": "config is required to update resource", "success": False}
    return {"updated": resource_id, "config": config, "success": True}


@tool
def move_to_vpc(resource_id: str, vpc_id: str = None) -> dict:
    """
    Move a resource into or out of a VPC.

    Args:
        resource_id: ID of the resource to move (ec2, rds, lambda, alb)
        vpc_id: ID of the target VPC, or None/empty to remove from VPC

    Returns:
        Move operation result
    """
    return {"moved": resource_id, "vpc_id": vpc_id, "success": True}


@tool
def deploy_infrastructure() -> str:
    """
    Deploy the infrastructure to AWS. This requires human approval.

    Returns:
        Deployment status
    """
    # This will trigger HITL on the frontend
    return "deployment_requested"


backend_tools = [
    add_resource,
    connect_resources,
    remove_resource,
    update_resource,
    move_to_vpc,
    deploy_infrastructure,
]

backend_tool_names = [t.name for t in backend_tools]


# -----------------------------------------------------------------------------
# Graph Nodes
# -----------------------------------------------------------------------------


async def architect_node(state: AgentState, config: RunnableConfig) -> Command[str]:
    """
    Main architect node - LLM with tools for designing infrastructure.
    Uses ReAct pattern to iteratively build the diagram.
    """
    model = ChatOpenAI(
        model="gpt-5.1",
        temperature=0.7,
        max_tokens=1000,
    )

    # Bind all tools
    model_with_tools = model.bind_tools(
        [
            *state.get("tools", []),
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
You help users design AWS infrastructure visually on a canvas.

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
- deploy_infrastructure: Deploy to AWS (requires approval)
- focusNode: Zoom to a specific node on canvas (frontend)
- highlightPath: Highlight connections between nodes (frontend)

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

    # No backend tools called, end turn
    return Command(
        goto="validate_node",
        update={
            "messages": [response],
            "status": "validating",
        },
    )


async def tool_node_wrapper(state: AgentState, config: RunnableConfig) -> Command[str]:
    """
    Wrapper around ToolNode to process tool results and update state.
    """
    # Run the actual tool node
    tool_node = ToolNode(tools=backend_tools)
    result = await tool_node.ainvoke(state, config)

    # Process tool results to update nodes/edges
    new_nodes = list(state.get("nodes", []))
    new_edges = list(state.get("edges", []))
    new_logs = list(state.get("logs", []))

    messages = result.get("messages", [])
    for msg in messages:
        content = msg.content if hasattr(msg, "content") else str(msg)

        # Try to parse as dict if it looks like one
        if isinstance(content, str) and content.startswith("{"):
            try:
                import json

                data = json.loads(content.replace("'", '"'))

                # Handle add_resource result
                if "id" in data and "type" in data:
                    # Validate parentId if provided
                    parent_id = data.get("parentId")
                    if parent_id:
                        # Check if VPC exists in state or new_nodes created this turn
                        all_nodes = [*state.get("nodes", []), *new_nodes]
                        vpc_exists = any(
                            n["id"] == parent_id and n["type"] == "vpc"
                            for n in all_nodes
                        )
                        if not vpc_exists:
                            new_logs.append(
                                log_thought(
                                    state,
                                    "tool_node",
                                    f"Invalid vpc_id: {parent_id} does not exist",
                                    "error",
                                )
                            )
                            continue  # Skip creating this node

                    # Frontend applies tier-based layout; position is placeholder
                    position = {"x": 0, "y": 0}
                    new_node = {
                        "id": data["id"],
                        "type": data["type"],
                        "position": position,
                        "config": data.get("config", {}),
                        "status": data.get("status", "healthy"),
                        "tier": data.get("tier", RESOURCE_TIER_MAP.get(data["type"], "compute")),
                    }
                    # Preserve parentId for VPC containment
                    if parent_id:
                        new_node["parentId"] = parent_id

                    new_nodes.append(new_node)
                    location = f" inside VPC {parent_id}" if parent_id else ""
                    new_logs.append(
                        log_thought(
                            state,
                            "tool_node",
                            f"Added {data['type']} resource: {data['id']}{location}",
                            "success",
                        )
                    )

                # Handle connect_resources result
                elif "source" in data and "target" in data:
                    new_edge = {
                        "id": data["id"],
                        "source": data["source"],
                        "target": data["target"],
                    }
                    new_edges.append(new_edge)
                    new_logs.append(
                        log_thought(
                            state,
                            "tool_node",
                            f"Connected {data['source']} -> {data['target']}",
                            "success",
                        )
                    )

                # Handle remove_resource result
                elif "removed" in data:
                    resource_id = data["removed"]
                    # Check if resource actually exists before removing
                    resource_exists = any(n["id"] == resource_id for n in new_nodes)
                    if resource_exists:
                        new_nodes = [n for n in new_nodes if n["id"] != resource_id]
                        new_edges = [
                            e
                            for e in new_edges
                            if e["source"] != resource_id and e["target"] != resource_id
                        ]
                        new_logs.append(
                            log_thought(
                                state, "tool_node", f"Removed resource: {resource_id}", "info"
                            )
                        )
                    else:
                        new_logs.append(
                            log_thought(
                                state, "tool_node", f"Resource {resource_id} not found (already removed)", "warning"
                            )
                        )

                # Handle update_resource result
                elif "updated" in data:
                    resource_id = data["updated"]
                    new_config = data.get("config", {})
                    for node in new_nodes:
                        if node["id"] == resource_id:
                            node["config"] = {**node.get("config", {}), **new_config}
                    new_logs.append(
                        log_thought(
                            state,
                            "tool_node",
                            f"Updated resource: {resource_id}",
                            "info",
                        )
                    )

                # Handle move_to_vpc result
                elif "moved" in data:
                    resource_id = data["moved"]
                    target_vpc_id = data.get("vpc_id")

                    # Validate target VPC exists if specified
                    if target_vpc_id:
                        all_nodes = [*state.get("nodes", []), *new_nodes]
                        vpc_exists = any(
                            n["id"] == target_vpc_id and n["type"] == "vpc"
                            for n in all_nodes
                        )
                        if not vpc_exists:
                            new_logs.append(
                                log_thought(
                                    state,
                                    "tool_node",
                                    f"Cannot move {resource_id}: VPC {target_vpc_id} does not exist",
                                    "error",
                                )
                            )
                            continue

                    # Find and update the resource's parentId
                    for node in new_nodes:
                        if node["id"] == resource_id:
                            if target_vpc_id:
                                node["parentId"] = target_vpc_id
                                new_logs.append(
                                    log_thought(
                                        state,
                                        "tool_node",
                                        f"Moved {resource_id} into VPC {target_vpc_id}",
                                        "success",
                                    )
                                )
                            else:
                                # Remove from VPC
                                node.pop("parentId", None)
                                new_logs.append(
                                    log_thought(
                                        state,
                                        "tool_node",
                                        f"Removed {resource_id} from VPC",
                                        "info",
                                    )
                                )
                            break

            except (json.JSONDecodeError, KeyError):
                pass

    # Recalculate cost immediately after node changes to keep state consistent
    # (Don't wait for cost_estimator_node - state may be captured mid-run)
    updated_cost = sum(calculate_resource_cost(node) for node in new_nodes)

    # Append current state summary to tool messages so agent knows what exists
    state_summary = generate_state_summary(new_nodes, new_edges)
    enriched_messages = []
    for msg in messages:
        if hasattr(msg, "content") and isinstance(msg.content, str):
            # Create new message with state summary appended
            enriched_msg = ToolMessage(
                content=msg.content + state_summary,
                tool_call_id=getattr(msg, "tool_call_id", ""),
                name=getattr(msg, "name", None),
            )
            enriched_messages.append(enriched_msg)
        else:
            enriched_messages.append(msg)

    return Command(
        goto="architect_node",
        update={
            "messages": enriched_messages,
            "nodes": new_nodes,
            "edges": new_edges,
            "logs": new_logs,
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
    errors: List[ValidationResult] = []

    new_logs = list(state.get("logs", []))
    new_logs.append(log_thought(state, "validate", "Running validation checks...", "info"))

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

# Compile graph (LangGraph API handles persistence automatically)
# Increase recursion limit for complex operations (default is 25)
graph = workflow.compile().with_config(recursion_limit=75)
