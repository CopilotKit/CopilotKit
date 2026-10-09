package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Function;

/**
 * Returns a mock current price for a stock ticker.
 * Registered as "get_stock_price" in AgentConfig.
 *
 * <p>Mirrors langgraph-python's {@code get_stock_price}
 * ({@code tool_rendering_agent.py}): the optional {@code price_usd} and
 * {@code change_pct} arguments let the LLM (or aimock fixture) script a
 * deterministic quote for testing — when supplied, the tool echoes them back
 * verbatim. When omitted, the tool returns mock random values. This is the
 * deterministic-arguments pattern shared with {@link RollD20Tool}.
 */
public class GetStockPriceTool implements Function<GetStockPriceTool.Request, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record Request(
            String ticker,
            @JsonProperty("price_usd") Double priceUsd,
            @JsonProperty("change_pct") Double changePct) {}

    @Override
    public String apply(Request request) {
        String ticker = request.ticker() != null
                ? request.ticker().toUpperCase()
                : "UNKNOWN";

        ThreadLocalRandom rnd = ThreadLocalRandom.current();
        double priceUsd = request.priceUsd() != null
                ? round2(request.priceUsd())
                : round2(100 + rnd.nextInt(0, 401) + rnd.nextInt(0, 100) / 100.0);
        double changePct = request.changePct() != null
                ? round2(request.changePct())
                : round2((rnd.nextBoolean() ? 1 : -1) * rnd.nextInt(0, 301) / 100.0);

        try {
            return MAPPER.writeValueAsString(Map.of(
                    "ticker", ticker,
                    "price_usd", priceUsd,
                    "change_pct", changePct
            ));
        } catch (Exception e) {
            // Build the error payload via Jackson so an exception message
            // containing `"`, `\`, or newlines cannot produce malformed JSON
            // that the LLM (or aimock) sees as an unparseable tool_result.
            try {
                return MAPPER.writeValueAsString(Map.of(
                        "error", "Failed to serialize stock data: " + e.getMessage()));
            } catch (Exception fatal) {
                return "{\"error\":\"Failed to serialize stock data\"}";
            }
        }
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
