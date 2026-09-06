from agents.conversational_flows import CONVERSATIONAL_FLOW_TYPES


EXPECTED_FEATURES = {
    "chat",
    "declarative-gen-ui",
    "a2ui-fixed-schema",
    "byoc-hashbrown",
    "byoc-json-render",
    "beautiful-chat",
    "mcp-apps",
    "shared-state-read-write",
    "shared-state-read",
    "shared-state-streaming",
    "multimodal",
    "frontend-tools",
    "a2ui-recovery",
    "subagents",
    "gen-ui-agent",
    "gen-ui-tool-based",
    "reasoning",
    "interrupt",
    "tool-rendering",
    "tool-rendering-reasoning",
}


def test_every_showcase_backend_has_a_native_conversational_flow():
    assert set(CONVERSATIONAL_FLOW_TYPES) == EXPECTED_FEATURES

    for flow_type in CONVERSATIONAL_FLOW_TYPES.values():
        flow = flow_type()
        assert flow.conversational is True
        assert callable(flow.stream_turn)
        assert flow.conversational_config.defer_trace_finalization is False


def test_conversational_flows_complete_each_public_turn_without_terminating_session():
    for flow_type in CONVERSATIONAL_FLOW_TYPES.values():
        flow = flow_type()
        assert flow.route_turn(None) == "ag_ui_complete"
        assert flow.end_conversation() is None
        assert flow.finish_ag_ui_turn() is None


def test_server_registers_one_public_conversational_endpoint_per_backend():
    from agent_server import app

    paths = {
        route.path
        for route in app.routes
        if route.path.startswith("/conversational_flows/")
    }

    assert paths == {
        f"/conversational_flows/{feature}" for feature in EXPECTED_FEATURES
    }
