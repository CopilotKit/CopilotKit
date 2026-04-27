package com.copilotkit.showcase.springai;

import com.agui.server.spring.AgUiParameters;
import com.agui.server.spring.AgUiService;
import com.agui.spring.ai.SpringAIAgent;
import com.copilotkit.showcase.springai.tools.DisplayFlightTool;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.memory.InMemoryChatMemoryRepository;
import org.springframework.ai.chat.memory.MessageWindowChatMemory;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.tool.function.FunctionToolCallback;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * A2UI Fixed Schema demo — dedicated controller at /a2ui-fixed-schema/run.
 *
 * Registers a single `display_flight` tool whose output is the fixed
 * flight-card component tree plus a data model. The A2UI middleware on the
 * runtime converts the a2ui_operations container into activity events, and
 * the frontend catalog pins each component name to a React renderer.
 */
@RestController
public class A2uiFixedSchemaController {

    private final AgUiService agUiService;
    private final ChatModel chatModel;

    @Autowired
    public A2uiFixedSchemaController(AgUiService agUiService, ChatModel chatModel) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
    }

    @PostMapping("/a2ui-fixed-schema/run")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) {
        SpringAIAgent agent = buildAgent();
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    private SpringAIAgent buildAgent() {
        ChatMemory memory = MessageWindowChatMemory.builder()
                .chatMemoryRepository(new InMemoryChatMemoryRepository())
                .maxMessages(10)
                .build();
        try {
            return SpringAIAgent.builder()
                    .agentId("a2ui-fixed-schema")
                    .chatModel(chatModel)
                    .chatMemory(memory)
                    .systemMessage("""
                            You are a flight-search assistant. When the user asks about a flight,
                            call the display_flight tool with the origin airport code, destination
                            airport code, airline, and price string (e.g. "$289"). Use 3-letter
                            airport codes. After calling the tool, reply with a brief confirmation
                            in plain text.
                            """)
                    .toolCallback(
                            FunctionToolCallback.builder("display_flight", new DisplayFlightTool())
                                    .description("Display a flight card for the given trip")
                                    .inputType(DisplayFlightTool.Request.class)
                                    .build()
                    )
                    .build();
        } catch (Exception e) {
            throw new RuntimeException("Failed to build a2ui-fixed-schema agent", e);
        }
    }
}
