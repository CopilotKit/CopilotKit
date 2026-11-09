// OpenAI 2.6 marks the native reasoning option as experimental.
#pragma warning disable OPENAI001
using Microsoft.Extensions.AI;
using OpenAI.Chat;

/// <summary>Keep Luna function calling compatible with Chat Completions.</summary>
public static class LunaChatClientExtensions
{
    public static IChatClient AsLunaChatClient(this ChatClient client)
    {
        var adapted = client.AsIChatClient();
        if (client.Model != "gpt-6-luna") return adapted;

        return adapted.AsBuilder().ConfigureOptions(options =>
        {
            var originalFactory = options.RawRepresentationFactory;
            options.RawRepresentationFactory = chatClient =>
            {
                var native = originalFactory?.Invoke(chatClient) as ChatCompletionOptions
                    ?? new ChatCompletionOptions();
                native.ReasoningEffortLevel = new("none");
                return native;
            };
        }).Build();
    }
}

#pragma warning restore OPENAI001
