package com.copilotkit.showcase.springai;

import com.copilotkit.showcase.springai.model.SalesTodo;
import com.copilotkit.showcase.springai.tools.WeatherRequest;
import com.copilotkit.showcase.springai.tools.WeatherTool;
import com.copilotkit.showcase.springai.tools.QueryDataTool;
import com.copilotkit.showcase.springai.tools.ScheduleMeetingTool;
import com.copilotkit.showcase.springai.tools.GetSalesTodosTool;
import com.copilotkit.showcase.springai.tools.ManageSalesTodosTool;
import com.copilotkit.showcase.springai.tools.SearchFlightsTool;
import com.copilotkit.showcase.springai.tools.GenerateA2uiTool;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.tool.function.FunctionToolCallback;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class AgentConfig {

    /**
     * Main agentic chat agent. Uses {@link StreamingToolAgent} which streams
     * text via {@code .stream()} for real-time delivery and falls back to
     * {@code .call()} when tool execution is needed. This replaces the stock
     * AG-UI {@code SpringAIAgent} which used {@code .stream()} exclusively
     * and never executed tool callbacks (Spring AI streaming does not
     * auto-execute tools).
     */
    @Bean
    public StreamingToolAgent agent(ChatModel chatModel) {
        // Shared mutable todos list between get/manage tools
        var salesTodosTool = new GetSalesTodosTool();
        List<SalesTodo> sharedTodos = salesTodosTool.getTodos();
        var manageSalesTodosTool = new ManageSalesTodosTool(sharedTodos);

        return StreamingToolAgent.builder()
                .agentId("agentic_chat")
                .chatModel(chatModel)
                .systemMessage("""
                    You are a helpful assistant for the CopilotKit showcase.
                    You can check the weather using the get_weather tool.
                    You can query financial/business data using the query_data tool.
                    You can schedule meetings using the schedule_meeting tool.
                    You can manage the sales pipeline using get_sales_todos and manage_sales_todos tools.
                    You can search for flights using the search_flights tool.
                    You can generate dynamic UI using the generate_a2ui tool.
                    For other tools (change_background, generate_haiku, generate_task_steps,
                    pieChart, barChart, scheduleTime, toggleTheme),
                    these are provided by the frontend — use them when relevant to the user's request.
                    When asked to plan or create steps, use the generate_task_steps tool.
                    When asked about weather, use the get_weather tool.
                    When asked about data, charts, or analytics, use the query_data tool.
                    When asked to schedule a meeting, use the schedule_meeting tool.
                    When asked about the sales pipeline or deals, use get_sales_todos first.
                    When asked to search for flights, use the search_flights tool.
                    Keep responses concise and helpful.
                    """)
                .toolCallback(
                    FunctionToolCallback.builder("get_weather", new WeatherTool())
                        .description("Get current weather for a location")
                        .inputType(WeatherRequest.class)
                        .build()
                )
                .toolCallback(
                    FunctionToolCallback.builder("query_data", new QueryDataTool())
                        .description("Query financial data for charts and analytics")
                        .inputType(QueryDataTool.Request.class)
                        .build()
                )
                .toolCallback(
                    FunctionToolCallback.builder("schedule_meeting", new ScheduleMeetingTool())
                        .description("Schedule a meeting with a given reason and duration")
                        .inputType(ScheduleMeetingTool.Request.class)
                        .build()
                )
                .toolCallback(
                    FunctionToolCallback.builder("get_sales_todos", salesTodosTool)
                        .description("Get the current sales pipeline todos")
                        .inputType(GetSalesTodosTool.Request.class)
                        .build()
                )
                .toolCallback(
                    FunctionToolCallback.builder("manage_sales_todos", manageSalesTodosTool)
                        .description("Update the sales pipeline with a new set of todos")
                        .inputType(ManageSalesTodosTool.Request.class)
                        .build()
                )
                .toolCallback(
                    FunctionToolCallback.builder("search_flights", new SearchFlightsTool())
                        .description("Search for available flights between two cities")
                        .inputType(SearchFlightsTool.Request.class)
                        .build()
                )
                .toolCallback(
                    FunctionToolCallback.builder("generate_a2ui", new GenerateA2uiTool(chatModel))
                        .description("Generate dynamic A2UI components using a secondary LLM call")
                        .inputType(GenerateA2uiTool.Request.class)
                        .build()
                )
                .build();
    }
}
