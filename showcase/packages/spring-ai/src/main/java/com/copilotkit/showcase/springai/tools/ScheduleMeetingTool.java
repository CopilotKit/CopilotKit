package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.function.Function;

public class ScheduleMeetingTool implements Function<ScheduleMeetingTool.Request, String> {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record Request(String reason, int durationMinutes) {}

    @Override
    public String apply(Request request) {
        try {
            return MAPPER.writeValueAsString(Map.of(
                "status", "pending_approval",
                "reason", request.reason(),
                "duration", request.durationMinutes() + " minutes"
            ));
        } catch (Exception e) {
            return "{\"status\":\"error\",\"message\":\"serialization failed\"}";
        }
    }
}
