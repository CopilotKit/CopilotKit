package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Secondary LLM call to dynamically generate A2UI components.
 * Registered as "generate_a2ui" in AgentConfig.
 */
public class GenerateA2uiTool implements Function<GenerateA2uiTool.Request, String> {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CATALOG_ID = "copilotkit://app-dashboard-catalog";

    public record Request(String userRequest) {}

    private final ChatModel chatModel;

    public GenerateA2uiTool(ChatModel chatModel) {
        this.chatModel = chatModel;
    }

    @Override
    public String apply(Request request) {
        try {
            String systemPrompt = """
                You are a UI generator. Given a user request, generate A2UI v0.9 components.
                You MUST respond with ONLY a JSON object (no markdown, no explanation) with this exact structure:
                {
                  "surfaceId": "dynamic-surface",
                  "catalogId": "copilotkit://app-dashboard-catalog",
                  "components": [<A2UI v0.9 component array>],
                  "data": {<optional initial data>}
                }
                The root component must have id "root".
                Available components: Row, Column, Text, Card, Button, Badge, Table, Chart.
                """;

            ChatResponse response = chatModel.call(
                new Prompt(List.of(
                    new SystemMessage(systemPrompt),
                    new UserMessage(request.userRequest())
                ))
            );

            String content = response.getResult().getOutput().getText();

            // Parse the LLM response to extract A2UI args
            JsonNode args = MAPPER.readTree(content);
            String surfaceId = args.has("surfaceId") ? args.get("surfaceId").asText() : "dynamic-surface";
            String catalogId = args.has("catalogId") ? args.get("catalogId").asText() : CATALOG_ID;

            var ops = new java.util.ArrayList<>(List.of(
                Map.of("type", "create_surface", "surfaceId", surfaceId, "catalogId", catalogId),
                Map.of("type", "update_components", "surfaceId", surfaceId,
                       "components", MAPPER.readValue(args.get("components").toString(), List.class))
            ));

            if (args.has("data") && !args.get("data").isNull()) {
                ops.add(Map.of("type", "update_data_model", "surfaceId", surfaceId,
                              "data", MAPPER.readValue(args.get("data").toString(), Map.class)));
            }

            return MAPPER.writeValueAsString(Map.of("a2ui_operations", ops));
        } catch (Exception e) {
            return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
        }
    }
}
