package com.copilotkit.showcase.springai;

import com.agui.spring.ai.SpringAIAgent;
import com.copilotkit.showcase.springai.tools.WeatherRequest;
import com.copilotkit.showcase.springai.tools.WeatherTool;
import com.copilotkit.showcase.springai.tools.QueryDataTool;
import com.copilotkit.showcase.springai.tools.ScheduleMeetingTool;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.memory.InMemoryChatMemoryRepository;
import org.springframework.ai.chat.memory.MessageWindowChatMemory;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.tool.function.FunctionToolCallback;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AgentConfig {

    @Bean
    public ChatMemory chatMemory() {
        return MessageWindowChatMemory.builder()
                .chatMemoryRepository(new InMemoryChatMemoryRepository())
                .maxMessages(10)
                .build();
    }

    @Bean
    public SpringAIAgent agent(ChatModel chatModel, ChatMemory chatMemory) {
        try {
            return SpringAIAgent.builder()
                    .agentId("agentic_chat")
                    .chatModel(chatModel)
                    .chatMemory(chatMemory)
                    .systemMessage("""
                        You are a helpful assistant for the CopilotKit showcase.
                        You can check the weather using the get_weather tool.
                        You can query financial/business data using the query_data tool.
                        You can schedule meetings using the schedule_meeting tool.
                        For other tools (change_background, generate_haiku, generate_task_steps,
                        pieChart, barChart, scheduleTime, toggleTheme),
                        these are provided by the frontend — use them when relevant to the user's request.
                        When asked to plan or create steps, use the generate_task_steps tool.
                        When asked about weather, use the get_weather tool.
                        When asked about data, charts, or analytics, use the query_data tool.
                        When asked to schedule a meeting, use the schedule_meeting tool.
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
                    .build();
        } catch (Exception e) {
            throw new RuntimeException("Failed to build SpringAIAgent", e);
        }
    }
}
