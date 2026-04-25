package com.copilotkit.showcase.springai;

import com.agui.server.spring.AgUiParameters;
import com.agui.server.spring.AgUiService;
import com.agui.spring.ai.SpringAIAgent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.memory.InMemoryChatMemoryRepository;
import org.springframework.ai.chat.memory.MessageWindowChatMemory;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Set;

/**
 * Agent Config Object demo — dedicated controller at /agent-config/run.
 *
 * Reads three forwarded properties from the AG-UI request envelope
 * (`forwardedProps.tone`, `forwardedProps.expertise`,
 * `forwardedProps.responseLength`) and builds a per-request SpringAIAgent
 * with a system prompt composed from those three axes. Mirrors the
 * LangGraph variant (src/agents/agent_config_agent.py).
 *
 * Keeping this on its own endpoint means the shared /agent bean is
 * unaffected — other demos keep their fixed prompt + tool list.
 */
@RestController
public class AgentConfigController {

    private static final Set<String> VALID_TONES =
            Set.of("professional", "casual", "enthusiastic");
    private static final Set<String> VALID_EXPERTISE =
            Set.of("beginner", "intermediate", "expert");
    private static final Set<String> VALID_LENGTHS =
            Set.of("concise", "detailed");

    private static final String DEFAULT_TONE = "professional";
    private static final String DEFAULT_EXPERTISE = "intermediate";
    private static final String DEFAULT_LENGTH = "concise";

    private final AgUiService agUiService;
    private final ChatModel chatModel;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    public AgentConfigController(AgUiService agUiService, ChatModel chatModel) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
    }

    @PostMapping("/agent-config/run")
    public ResponseEntity<SseEmitter> run(@RequestBody String rawBody) throws Exception {
        JsonNode root = objectMapper.readTree(rawBody);
        JsonNode forwarded = root.path("forwardedProps");

        String tone = normalize(
                forwarded.path("tone").asText(DEFAULT_TONE), VALID_TONES, DEFAULT_TONE);
        String expertise = normalize(
                forwarded.path("expertise").asText(DEFAULT_EXPERTISE),
                VALID_EXPERTISE, DEFAULT_EXPERTISE);
        String length = normalize(
                forwarded.path("responseLength").asText(DEFAULT_LENGTH),
                VALID_LENGTHS, DEFAULT_LENGTH);

        String systemPrompt = buildSystemPrompt(tone, expertise, length);

        AgUiParameters params = objectMapper.readValue(rawBody, AgUiParameters.class);
        SpringAIAgent perRequestAgent = buildAgent(systemPrompt);

        SseEmitter emitter = agUiService.runAgent(perRequestAgent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    private static String normalize(String value, Set<String> allowed, String fallback) {
        return value != null && allowed.contains(value) ? value : fallback;
    }

    private SpringAIAgent buildAgent(String systemPrompt) {
        ChatMemory memory = MessageWindowChatMemory.builder()
                .chatMemoryRepository(new InMemoryChatMemoryRepository())
                .maxMessages(10)
                .build();
        try {
            return SpringAIAgent.builder()
                    .agentId("agent-config-demo")
                    .chatModel(chatModel)
                    .chatMemory(memory)
                    .systemMessage(systemPrompt)
                    .build();
        } catch (Exception e) {
            throw new RuntimeException("Failed to build agent-config agent", e);
        }
    }

    private static String buildSystemPrompt(String tone, String expertise, String length) {
        String toneRule = switch (tone) {
            case "casual" ->
                "Use friendly, conversational language. Contractions OK. Light humor welcome.";
            case "enthusiastic" ->
                "Use upbeat, energetic language. Exclamation points OK. Emoji OK.";
            default ->
                "Use neutral, precise language. No emoji. Short sentences.";
        };
        String expertiseRule = switch (expertise) {
            case "beginner" -> "Assume no prior knowledge. Define jargon. Use analogies.";
            case "expert" -> "Assume technical fluency. Use precise terminology. Skip basics.";
            default -> "Assume common terms are understood; explain specialized terms.";
        };
        String lengthRule = switch (length) {
            case "detailed" ->
                "Respond in multiple paragraphs with examples where relevant.";
            default -> "Respond in 1-3 sentences.";
        };
        return """
                You are a helpful assistant.

                Tone: %s
                Expertise level: %s
                Response length: %s
                """.formatted(toneRule, expertiseRule, lengthRule);
    }
}
