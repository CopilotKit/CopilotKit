package com.copilotkit.showcase.springai;

import com.agui.core.tool.Tool;
import com.agui.core.agent.AgentSubscriber;
import com.agui.core.event.BaseEvent;
import com.agui.core.message.AssistantMessage;
import com.agui.core.tool.ToolCall;
import org.springframework.ai.chat.model.ToolContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class StreamingToolAgentMcpToolsTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void forwardsRuntimeSchemaAlongsideUnchangedBackendCallback() throws Exception {
        ToolCallback backend = backend("get_weather");
        Tool runtime = runtimeTool("create_view");
        var callbacks = StreamingToolAgent.streamingToolCallbacks(List.of(backend), List.of(runtime));
        assertEquals(2, callbacks.size());
        assertSame(backend, callbacks.get(0));
        assertEquals(runtime.name(), callbacks.get(1).getToolDefinition().name());
        assertEquals(runtime.description(), callbacks.get(1).getToolDefinition().description());
        assertEquals(JSON.valueToTree(runtime.parameters()),
                JSON.readTree(callbacks.get(1).getToolDefinition().inputSchema()));
    }

    @Test
    void runtimeDefinitionsDoNotMutateOrLeakIntoLaterRequests() throws Exception {
        var backend = new ArrayList<>(List.of(backend("get_weather")));
        var runtime = new ArrayList<>(List.of(runtimeTool("create_view")));
        var first = StreamingToolAgent.streamingToolCallbacks(backend, runtime);
        runtime.clear();
        var second = StreamingToolAgent.streamingToolCallbacks(backend, runtime);
        assertEquals(2, first.size());
        assertEquals(1, second.size());
        assertEquals(1, backend.size());
        assertEquals(List.of(backend.get(0)),
                StreamingToolAgent.streamingToolCallbacks(backend, null));
    }

    @Test
    void backendDefinitionWinsCollisionsAndDuplicateRuntimeNamesAreNotAdvertised() throws Exception {
        ToolCallback backend = backend("create_view");
        Tool runtime = runtimeTool("create_view");
        assertEquals(List.of(backend),
                StreamingToolAgent.streamingToolCallbacks(List.of(backend), List.of(runtime)));
        assertEquals(1, StreamingToolAgent.streamingToolCallbacks(List.of(), List.of(runtime, runtime)).size());
    }

    @Test
    void runtimeToolCannotExecuteInsideJava() throws Exception {
        var callback = StreamingToolAgent.streamingToolCallbacks(
                List.of(), List.of(runtimeTool("create_view"))).get(0);
        assertThrows(IllegalStateException.class, () -> callback.call("{}"));
    }

    @Test
    void selectedMixedCallsKeepIdsArgumentsContextAndActualBackendResult() throws Exception {
        ToolContext context = new ToolContext(Map.of("request-context", "catalog"));
        AtomicInteger executions = new AtomicInteger();
        ToolCallback callback = new ToolCallback() {
            public ToolDefinition getToolDefinition() { return backend("get_revenue_chart").getToolDefinition(); }
            public String call(String input) { throw new AssertionError("Context must be forwarded"); }
            public String call(String input, ToolContext supplied) {
                assertSame(context, supplied);
                assertEquals("{}", input);
                executions.incrementAndGet();
                return "actual chart result";
            }
        };
        var events = new ArrayList<BaseEvent>();
        var assistant = new AssistantMessage();
        var announced = new ArrayList<ToolCall>();
        AgentSubscriber subscriber = new AgentSubscriber() {
            public void onNewToolCall(ToolCall call) { announced.add(call); }
        };
        StreamingToolAgent.emitSelectedToolCalls(List.of(
                new StreamingToolAgent.DetectedToolCall("mcp-id", "create_view", "{\"elements\":\"[]\"}"),
                new StreamingToolAgent.DetectedToolCall("backend-id", "get_revenue_chart", "{}")),
                Set.of("create_view"), List.of(callback), context, "assistant-id",
                assistant, subscriber, events::add);
        assertEquals(1, executions.get());
        assertEquals(2, announced.size());
        assertEquals(announced, assistant.getToolCalls());
        var json = JSON.valueToTree(events);
        assertEquals("mcp-id", json.get(0).path("toolCallId").asText());
        assertEquals("backend-id", json.get(3).path("toolCallId").asText());
        assertEquals(7, events.size());
        assertEquals("backend-id", json.get(6).path("toolCallId").asText());
        assertEquals("actual chart result", json.get(6).path("content").asText());
        assertNotEquals("assistant-id", json.get(6).path("messageId").asText());
    }

    @Test
    void laterBackendFailurePreservesSelectedEnvelopesAndCompletedResults() {
        var events = new ArrayList<BaseEvent>();
        var assistant = new AssistantMessage();
        var invoked = new ArrayList<String>();
        var callbacks = new ArrayList<ToolCallback>();
        for (String name : List.of("first", "fails", "unexecuted")) {
            callbacks.add(new ToolCallback() {
                public ToolDefinition getToolDefinition() { return backend(name).getToolDefinition(); }
                public String call(String input) {
                    invoked.add(name);
                    if (name.equals("fails")) throw new IllegalStateException("backend failed");
                    return "completed first result";
                }
            });
        }
        assertThrows(IllegalStateException.class, () -> StreamingToolAgent.emitSelectedToolCalls(List.of(
                new StreamingToolAgent.DetectedToolCall("mcp", "create_view", "{}"),
                new StreamingToolAgent.DetectedToolCall("one", "first", "{}"),
                new StreamingToolAgent.DetectedToolCall("two", "fails", "{}"),
                new StreamingToolAgent.DetectedToolCall("three", "unexecuted", "{}")),
                Set.of("create_view"), callbacks, new ToolContext(Map.of()), "assistant",
                assistant, new AgentSubscriber() {}, events::add));
        assertEquals(List.of("first", "fails"), invoked);
        assertEquals(4, assistant.getToolCalls().size());
        assertEquals(13, events.size());
        var result = JSON.valueToTree(events.get(12));
        assertEquals("one", result.path("toolCallId").asText());
        assertEquals("completed first result", result.path("content").asText());
    }

    private static Tool runtimeTool(String name) throws Exception {
        return JSON.readValue("""
                {"name":"%s","description":"Render the requested diagram",
                 "parameters":{"type":"object","properties":{"elements":{"type":"string"}},
                 "required":["elements"]}}
                """.formatted(name), Tool.class);
    }

    private static ToolCallback backend(String name) {
        ToolDefinition definition = ToolDefinition.builder().name(name)
                .description("Existing backend tool").inputSchema("{\"type\":\"object\"}").build();
        return new ToolCallback() {
            @Override
            public ToolDefinition getToolDefinition() { return definition; }
            @Override
            public String call(String input) { return "backend result"; }
        };
    }
}
