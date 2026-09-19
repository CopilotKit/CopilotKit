package com.copilotkit.showcase.springai;

import com.agui.core.event.BaseEvent;
import com.agui.core.state.State;
import com.agui.core.tool.ToolCall;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.function.FunctionToolCallback;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = "spring.ai.openai.api-key=test-key-not-used")
@TestPropertySource(properties = "OPENAI_API_KEY=test-key-not-used")
class GenUiAgentControllerTest {
    @Autowired private ObjectMapper mapper;

    private static final List<List<String>> PROGRESS = List.of(
            List.of("pending", "pending", "pending"),
            List.of("in_progress", "pending", "pending"),
            List.of("completed", "pending", "pending"),
            List.of("completed", "in_progress", "pending"),
            List.of("completed", "completed", "pending"),
            List.of("completed", "completed", "in_progress"),
            List.of("completed", "completed", "completed"));

    private String input(List<String> statuses) throws Exception {
        List<Map<String, String>> steps = new ArrayList<>();
        for (int i = 0; i < statuses.size(); i++) {
            steps.add(Map.of("id", "step-" + i, "title", "Meaningful task " + i,
                    "status", statuses.get(i)));
        }
        return mapper.writeValueAsString(Map.of("steps", steps));
    }

    @Test
    void providerTitlesSurviveRealCallbackSchemaAndHandler() throws Exception {
        State state = new State();
        List<BaseEvent> events = new ArrayList<>();
        var handler = new GenUiAgentController.SetStepsHandler(state, events::add, new ArrayList<>(), "parent", mapper);
        var callback = FunctionToolCallback.builder("set_steps", handler)
                .description("Publish steps").inputType(GenUiAgentController.SetStepsRequest.class).build();
        assertEquals("Published 3 step(s).", mapper.readTree(callback.call(input(PROGRESS.get(0)))).asText());
        JsonNode schema = mapper.readTree(callback.getToolDefinition().inputSchema());
        assertTrue(schema.toString().contains("\"title\""), schema.toString());
        JsonNode args = mapper.readTree(mapper.valueToTree(events.get(1)).path("delta").asText());
        assertEquals("Meaningful task 0", args.path("steps").get(0).path("title").asText());
        assertEquals("step-0", args.path("steps").get(0).path("id").asText());
    }

    @Test
    void snapshotsUseWireContractAndRetainIndependentFullHistory() throws Exception {
        State state = new State();
        List<String> nested = new ArrayList<>(List.of("initial"));
        state.set("context", Map.of("labels", nested));
        List<BaseEvent> events = new ArrayList<>();
        List<ToolCall> calls = new ArrayList<>();
        var handler = new GenUiAgentController.SetStepsHandler(state, events::add, calls, "parent", mapper);
        for (List<String> statuses : PROGRESS) {
            int before = events.size();
            handler.apply(mapper.readValue(input(statuses), GenUiAgentController.SetStepsRequest.class));
            assertEquals(before + 5, events.size(), "Events must reach the sink before the next callback");
        }
        nested.add("later mutation");
        assertEquals(35, events.size());
        assertEquals(7, calls.size());
        List<String> resultIds = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            List<String> types = new ArrayList<>();
            for (int j = 0; j < 5; j++) types.add(mapper.valueToTree(events.get(i * 5 + j)).path("type").asText());
            assertEquals(List.of("TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT", "STATE_SNAPSHOT"), types);
            JsonNode result = mapper.valueToTree(events.get(i * 5 + 3));
            resultIds.add(result.path("messageId").asText());
            assertEquals("Published 3 step(s).", result.path("content").asText());
            JsonNode event = mapper.readTree(mapper.writeValueAsString(events.get(i * 5 + 4)));
            assertTrue(event.has("snapshot"), event.toString());
            assertFalse(event.has("state"));
            assertEquals(1, event.path("snapshot").path("context").path("labels").size());
            for (int j = 0; j < 3; j++) {
                JsonNode step = event.path("snapshot").path("steps").get(j);
                assertEquals(PROGRESS.get(i).get(j), step.path("status").asText());
                assertEquals("Meaningful task " + j, step.path("title").asText());
                assertEquals("step-" + j, step.path("id").asText());
            }
        }
        assertEquals(7, resultIds.stream().distinct().count());
        assertFalse(resultIds.contains("parent"));
    }
    @Test
    void normalizesNullableStepsAndStatusesWithoutInventingContent() throws Exception {
        State state = new State();
        List<BaseEvent> events = new ArrayList<>();
        var handler = new GenUiAgentController.SetStepsHandler(state, events::add, new ArrayList<>(), "parent", mapper);
        assertEquals("Published 0 step(s).", handler.apply(new GenUiAgentController.SetStepsRequest(null)));
        assertEquals("Published 0 step(s).", handler.apply(new GenUiAgentController.SetStepsRequest(List.of())));
        var request = mapper.readValue("""
                {"steps":[null,{"id":"stable","title":"Actual task","status":" In-Progress "},
                {"id":null,"title":null,"status":"unknown"},{"id":"last","title":"Last task","status":null}]}
                """, GenUiAgentController.SetStepsRequest.class);
        assertEquals("Published 3 step(s).", handler.apply(request));
        JsonNode steps = mapper.valueToTree(state.get("steps"));
        assertEquals("stable", steps.get(0).path("id").asText());
        assertEquals("Actual task", steps.get(0).path("title").asText());
        assertEquals("in_progress", steps.get(0).path("status").asText());
        assertFalse(steps.get(1).path("id").asText().isBlank());
        assertEquals("", steps.get(1).path("title").asText());
        assertEquals("pending", steps.get(1).path("status").asText());
        assertEquals("pending", steps.get(2).path("status").asText());
    }

    @Test
    void serializationFailureDoesNotPublishSuccessfulToolResult() {
        State state = new State();
        state.set("invalid", new UnserializableValue());
        List<BaseEvent> events = new ArrayList<>();
        List<ToolCall> calls = new ArrayList<>();
        var handler = new GenUiAgentController.SetStepsHandler(state, events::add, calls, "parent", mapper);
        assertThrows(IllegalStateException.class,
                () -> handler.apply(new GenUiAgentController.SetStepsRequest(List.of())));
        assertTrue(events.isEmpty());
        assertTrue(calls.isEmpty());
    }

    static final class UnserializableValue {
        public String getValue() {
            throw new IllegalStateException("Cannot serialize this state value");
        }
    }

}
