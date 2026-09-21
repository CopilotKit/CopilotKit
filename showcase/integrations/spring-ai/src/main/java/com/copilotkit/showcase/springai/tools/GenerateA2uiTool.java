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
import java.util.function.BiFunction;
import com.agui.core.context.Context;
import org.springframework.ai.chat.model.ToolContext;

/**
 * Secondary LLM call to dynamically generate A2UI components.
 * Registered as "generate_a2ui" in AgentConfig.
 */
public class GenerateA2uiTool implements BiFunction<GenerateA2uiTool.Request, ToolContext, String> {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CATALOG_ID = "copilotkit://app-dashboard-catalog";

    public record Request(String userRequest) {}

    public static final String UI_CONTEXT_KEY = "showcase.a2ui.context";

    /** Immutable contract owned by one AG-UI run, never by the singleton tool. */
    public record UiContext(String catalogId, String instructions) {}

    public static UiContext uiContext(List<Context> contexts) {
        if (contexts == null) return null;
        String catalogId = null;
        for (Context context : contexts) {
            if (context.description() != null && context.description().startsWith("A2UI Component Schema")) {
                try {
                    JsonNode schema = MAPPER.readTree(context.value());
                    JsonNode id = schema.get("catalogId");
                    if (id != null && id.isTextual() && !id.asText().isBlank()) catalogId = id.asText();
                } catch (Exception e) {
                    throw new IllegalArgumentException("Invalid A2UI component schema", e);
                }
            }
        }
        if (catalogId == null) return null;
        StringBuilder instructions = new StringBuilder();
        for (Context context : contexts) {
            String description = context.description();
            String value = context.value();
            if (description == null || value == null) continue;
            if (description.startsWith("A2UI generation guidelines")) {
                // The client describes render_a2ui's transport. Keep the protocol
                // rules but let each Java boundary specify its actual transport.
                int rules = value.indexOf("COMPONENT ID RULES:");
                if (rules < 0) throw new IllegalArgumentException("Missing A2UI component rules");
                value = "Generate flat A2UI v0.9 components with id and component fields. "
                        + "Use only component names and properties from the supplied schema. "
                        + "Provide surfaceId, components and optional data.\n"
                        + value.substring(rules).replace("the \"data\" tool argument", "the \"data\" field");
            } else if (!description.startsWith("A2UI ")
                    && !description.equals("Sales dataset for Vantage Threads (the demo company)")
                    && !description.equals("Dashboard composition rules for A2UI surfaces")) {
                continue;
            }
            instructions.append(description).append("\n").append(value).append("\n\n");
        }
        return new UiContext(catalogId, instructions.toString());
    }

    private final ChatModel chatModel;

    public GenerateA2uiTool(ChatModel chatModel) {
        this.chatModel = chatModel;
    }

    @Override
    public String apply(Request request, ToolContext toolContext) {
        UiContext ui = toolContext != null
                && toolContext.getContext().get(UI_CONTEXT_KEY) instanceof UiContext supplied ? supplied : null;
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

            if (ui != null) {
                systemPrompt = "You are a UI generator. Respond with ONLY plain JSON, no markdown or tool calls.\n"
                        + "Return an object with surfaceId, catalogId, components and optional data.\n"
                        + "The catalogId MUST be " + ui.catalogId() + ". The root component has id root.\n"
                        + ui.instructions();
            }

            ChatResponse response = chatModel.call(
                new Prompt(List.of(
                    new SystemMessage(systemPrompt),
                    new UserMessage(request.userRequest())
                ))
            );

            String content = response.getResult().getOutput().getText();

            return serializeOperations(MAPPER.readTree(content), ui);
        } catch (Exception e) {
            return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
        }
    }

    static String serializeOperations(JsonNode args, UiContext ui) throws java.io.IOException {
        String surfaceId = args.has("surfaceId") ? args.get("surfaceId").asText() : "dynamic-surface";
        String catalogId = ui != null ? ui.catalogId()
                : args.has("catalogId") ? args.get("catalogId").asText() : CATALOG_ID;

        var ops = new java.util.ArrayList<>(List.of(
            Map.of("version", "v0.9", "createSurface",
                   Map.of("surfaceId", surfaceId, "catalogId", catalogId)),
            Map.of("version", "v0.9", "updateComponents",
                   Map.of("surfaceId", surfaceId,
                          "components", MAPPER.readValue(args.get("components").toString(), List.class)))
        ));

        if (args.has("data") && !args.get("data").isNull()) {
            ops.add(Map.of("version", "v0.9", "updateDataModel",
                          Map.of("surfaceId", surfaceId, "path", "/",
                                 "value", MAPPER.readValue(args.get("data").toString(), Map.class))));
        }

        return MAPPER.writeValueAsString(Map.of("a2ui_operations", ops));
    }
}
