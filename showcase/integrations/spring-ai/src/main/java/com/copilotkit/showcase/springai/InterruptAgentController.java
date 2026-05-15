package com.copilotkit.showcase.springai;

import com.agui.server.spring.AgUiParameters;
import com.agui.server.spring.AgUiService;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Interrupt-adapted scheduling agent — dedicated controller at
 * {@code /interrupt-adapted}.
 *
 * <p>Powers two demos ({@code gen-ui-interrupt} and {@code interrupt-headless})
 * that in the LangGraph showcase rely on the native {@code interrupt()}
 * primitive. Spring AI has no graph-interrupt, so the same UX is achieved via
 * "Strategy B": the backend agent advertises a scheduling system prompt that
 * tells the LLM to call {@code schedule_meeting}, but registers <b>no backend
 * tool callbacks</b>. The {@code schedule_meeting} tool is registered entirely
 * on the frontend via {@code useFrontendTool} with an async handler that
 * renders a time-picker and blocks until the user picks a slot or cancels.
 *
 * <p>The existing {@link StreamingToolAgent} already handles frontend-only tool
 * calls correctly: Phase 1 (streaming) detects the tool call, classifies it as
 * a frontend tool (because it appears in {@code input.tools()} from the
 * CopilotKit runtime but not in the backend's empty tool callback list), and
 * emits {@code TOOL_CALL_START/ARGS/END} events <b>without a result</b>. The
 * runtime then routes the tool call to the frontend handler, which resolves it
 * and re-invokes the agent with the tool result.
 */
@RestController
public class InterruptAgentController {

    private static final String SYSTEM_PROMPT = """
            You are a scheduling assistant. Whenever the user asks you to book \
            a call or schedule a meeting, you MUST call the `schedule_meeting` \
            tool. Pass a short `topic` describing the purpose of the meeting \
            and, if known, an `attendee` describing who the meeting is with.

            The `schedule_meeting` tool is implemented on the client: it \
            surfaces a time-picker UI to the user and returns the user's \
            selection. After the tool returns, briefly confirm whether the \
            meeting was scheduled and at what time, or note that the user \
            cancelled. Do NOT ask for approval yourself — always call the tool \
            and let the picker handle the decision.

            Keep responses short and friendly. After you finish executing \
            tools, always send a brief final assistant message summarizing what \
            happened so the message persists.
            """;

    private final AgUiService agUiService;
    private final ChatModel chatModel;

    @Autowired
    public InterruptAgentController(AgUiService agUiService, ChatModel chatModel) {
        this.agUiService = agUiService;
        this.chatModel = chatModel;
    }

    @PostMapping("/interrupt-adapted")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) {
        MessageListFilter.filterNulls(params);
        // No tool callbacks — `schedule_meeting` is a frontend tool injected
        // by the CopilotKit runtime. StreamingToolAgent's Phase 1 will detect
        // the tool call and classify it as frontend-only, emitting envelope
        // events without a result so the runtime routes to the frontend handler.
        StreamingToolAgent agent = StreamingToolAgent.builder()
                .agentId("interrupt-adapted")
                .chatModel(chatModel)
                .systemMessage(SYSTEM_PROMPT)
                .build();
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }
}
