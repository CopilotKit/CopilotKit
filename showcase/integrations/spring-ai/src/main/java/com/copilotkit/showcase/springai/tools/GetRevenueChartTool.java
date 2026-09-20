package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.function.Function;

/** Reads the shared revenue chart packaged by Maven as a classpath resource. */
public class GetRevenueChartTool implements Function<GetRevenueChartTool.Request, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private final String resourceName;

    public record Request() {}

    public GetRevenueChartTool() {
        this("/revenue-chart.json");
    }

    GetRevenueChartTool(String resourceName) {
        this.resourceName = resourceName;
    }

    @Override
    public String apply(Request request) {
        try (var stream = GetRevenueChartTool.class.getResourceAsStream(resourceName)) {
            if (stream == null) {
                throw new IllegalStateException("Missing revenue chart resource: " + resourceName);
            }
            var chart = MAPPER.readTree(new InputStreamReader(stream, StandardCharsets.UTF_8));
            if (chart == null || !chart.isObject()
                    || !chart.path("title").isTextual()
                    || !chart.path("subtitle").isTextual()
                    || !chart.path("data").isArray() || chart.path("data").isEmpty()) {
                throw new IOException("Expected chart title, subtitle, and data points");
            }
            for (var point : chart.path("data")) {
                if (!point.path("label").isTextual() || !point.path("value").isNumber()) {
                    throw new IOException("Expected each chart point to have a label and numeric value");
                }
            }
            return MAPPER.writeValueAsString(chart);
        } catch (IOException error) {
            throw new IllegalStateException("Could not load revenue chart resource: " + resourceName, error);
        }
    }
}
