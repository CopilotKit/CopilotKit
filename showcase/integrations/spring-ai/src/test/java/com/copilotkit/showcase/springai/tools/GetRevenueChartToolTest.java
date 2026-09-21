package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.function.FunctionToolCallback;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.*;

class GetRevenueChartToolTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void callbackAcceptsNoArgumentsAndReturnsTheSharedChart() throws Exception {
        var callback = FunctionToolCallback.builder("get_revenue_chart", new GetRevenueChartTool())
                .description("Get the shared six-month revenue chart")
                .inputType(GetRevenueChartTool.Request.class)
                .build();

        var schema = MAPPER.readTree(callback.getToolDefinition().inputSchema());
        assertEquals("object", schema.path("type").asText());
        assertEquals(0, schema.path("properties").size());
        assertEquals(0, schema.path("required").size());

        var actual = MAPPER.readTree(callback.call("{}"));
        var expected = MAPPER.readTree("""
                {"title":"Quarterly revenue","subtitle":"Last six months · USD thousands",
                 "data":[{"label":"Jan","value":38},{"label":"Feb","value":47},
                         {"label":"Mar","value":52},{"label":"Apr","value":49},
                         {"label":"May","value":63},{"label":"Jun","value":71}]}
                """);
        assertEquals(expected, actual);
        try (var resource = GetRevenueChartTool.class.getResourceAsStream("/revenue-chart.json")) {
            assertNotNull(resource, "Maven must package the canonical revenue resource");
            assertEquals(MAPPER.readTree(resource), actual);
        }
    }

    @Test
    void missingResourceFailsWithItsName() {
        var tool = new GetRevenueChartTool("/missing-revenue-chart.json");
        var error = assertThrows(IllegalStateException.class,
                () -> tool.apply(new GetRevenueChartTool.Request()));
        assertTrue(error.getMessage().contains("/missing-revenue-chart.json"));
    }

    @Test
    void malformedResourceFailsWithoutSubstituteData() {
        var tool = new GetRevenueChartTool("/application.properties");
        var error = assertThrows(IllegalStateException.class,
                () -> tool.apply(new GetRevenueChartTool.Request()));
        assertTrue(error.getMessage().contains("/application.properties"));
        assertInstanceOf(IOException.class, error.getCause());
    }
}
