package com.copilotkit.showcase.springai;

import com.agui.server.spring.AgUiParameters;
import com.agui.server.spring.AgUiService;
import com.agui.spring.ai.SpringAIAgent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

@RestController
public class AgentController {

    private final AgUiService agUiService;
    private final SpringAIAgent agent;

    @Autowired
    public AgentController(AgUiService agUiService, SpringAIAgent agent) {
        this.agUiService = agUiService;
        this.agent = agent;
    }

    @PostMapping("/")
    public ResponseEntity<SseEmitter> run(@RequestBody AgUiParameters params) {
        SseEmitter emitter = agUiService.runAgent(agent, params);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(emitter);
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "ok"));
    }
}
