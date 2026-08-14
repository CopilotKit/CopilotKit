package com.copilotkit.showcase.springai;

import com.agui.server.spring.AgUiParameters;
import com.agui.server.spring.AgUiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

@RestController
public class AgentController {

    private final AgUiService agUiService;
    private final StreamingToolAgent agent;

    @Autowired
    public AgentController(AgUiService agUiService, StreamingToolAgent agent) {
        this.agUiService = agUiService;
        this.agent = agent;
    }

    @PostMapping("/")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) {
        MessageListFilter.filterNulls(params);
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    /**
     * Liveness probe.
     *
     * <p>{@code /api/health} is an ALIAS of {@code /health} — same handler, same
     * response. Railway's {@code healthcheckPath} is {@code /api/health}, which
     * the Next.js half of this container serves today. Answering it here as well
     * means that when the Next.js process is removed and the agent becomes the
     * only listener, the existing Railway healthcheck keeps working with no
     * dashboard change. Today it is a pure addition: the agent's port is not the
     * one Railway probes.
     */
    @GetMapping({"/health", "/api/health"})
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    @GetMapping("/ok")
    public ResponseEntity<String> ok() {
        return ResponseEntity.ok("ok");
    }
}
