package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Function;

/**
 * Rolls a 20-sided die.
 * Registered as "roll_d20" in AgentConfig.
 *
 * <p>Mirrors langgraph-python's {@code roll_d20}
 * ({@code tool_rendering_agent.py}): the optional {@code value} argument lets
 * the LLM (or aimock fixture) script a deterministic roll for testing — the
 * tool simply echoes it back as the result. When called without {@code value}
 * (or with a value outside 1–20), the tool returns a random natural d20 roll.
 */
public class RollD20Tool implements Function<RollD20Tool.Request, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record Request(Integer value) {}

    @Override
    public String apply(Request request) {
        Integer value = request.value();
        int rolled = (value != null && value >= 1 && value <= 20)
                ? value
                : ThreadLocalRandom.current().nextInt(1, 21);

        try {
            return MAPPER.writeValueAsString(Map.of(
                    "sides", 20,
                    "value", rolled,
                    "result", rolled
            ));
        } catch (Exception e) {
            // Build the error payload via Jackson so an exception message
            // containing `"`, `\`, or newlines cannot produce malformed JSON
            // that the LLM (or aimock) sees as an unparseable tool_result.
            try {
                return MAPPER.writeValueAsString(Map.of(
                        "error", "Failed to serialize roll: " + e.getMessage()));
            } catch (Exception fatal) {
                return "{\"error\":\"Failed to serialize roll\"}";
            }
        }
    }
}
