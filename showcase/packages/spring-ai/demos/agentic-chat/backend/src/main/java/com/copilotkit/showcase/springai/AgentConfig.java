package com.copilotkit.showcase.springai;

import com.agui.spring.ai.SpringAIAgent;
import com.copilotkit.showcase.springai.tools.WeatherRequest;
import com.copilotkit.showcase.springai.tools.WeatherTool;
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
                        A frontend tool called change_background is also available
                        for changing the page's background when the user asks.
                        Keep responses concise and helpful.
                        """)
                    .toolCallback(
                            FunctionToolCallback.builder("get_weather", new WeatherTool())
                                    .description("Get current weather for a location")
                                    .inputType(WeatherRequest.class)
                                    .build()
                    )
                    .build();
        } catch (Exception e) {
            throw new RuntimeException("Failed to build SpringAIAgent", e);
        }
    }
}
