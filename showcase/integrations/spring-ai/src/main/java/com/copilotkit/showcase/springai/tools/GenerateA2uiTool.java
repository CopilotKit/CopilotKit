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
    // Must match the catalogId the frontend registers in
    // declarative-gen-ui/a2ui/catalog.ts (`declarative-gen-ui-catalog`) and
    // the route's `defaultCatalogId`. A mismatched id makes the renderer fail
    // with "Catalog not found" and the surface silently drops.
    private static final String CATALOG_ID = "declarative-gen-ui-catalog";

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
                  "catalogId": "declarative-gen-ui-catalog",
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

            // Emit v0.9 NESTED A2UI operations (mirrors the sibling
            // DisplayFlightTool). The a2ui-middleware (>=0.0.10) is
            // nested-only: it expects each op to carry `"version":"v0.9"`
            // with a camelCase operation key (`createSurface` /
            // `updateComponents` / `updateDataModel`) and the data-model
            // payload nested under `value` at a `path` (NOT a flat `data`
            // field). The legacy flat ops (`create_surface` /
            // `update_components` / `update_data_model`) are silently dropped
            // by the current middleware, so the surface never mounts.
            var ops = new java.util.ArrayList<>(List.of(
                Map.of("version", "v0.9",
                       "createSurface", Map.of(
                               "surfaceId", surfaceId,
                               "catalogId", catalogId)),
                Map.of("version", "v0.9",
                       "updateComponents", Map.of(
                               "surfaceId", surfaceId,
                               "components", MAPPER.readValue(
                                       args.get("components").toString(), List.class)))
            ));

            if (args.has("data") && !args.get("data").isNull()) {
                ops.add(Map.of("version", "v0.9",
                       "updateDataModel", Map.of(
                               "surfaceId", surfaceId,
                               "path", "/",
                               "value", MAPPER.readValue(
                                       args.get("data").toString(), Map.class))));
            }

            return MAPPER.writeValueAsString(Map.of("a2ui_operations", ops));
        } catch (Exception e) {
            return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
        }
    }
}
