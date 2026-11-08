using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.AI;
using OpenAI;
using Xunit;

namespace MsAgentDotnet.AgentTests;

public class LunaChatClientTests
{
    [Theory]
    [InlineData("gpt-6-luna", "none")]
    [InlineData("gpt-4o", null)]
    public async Task ToolRequestsDisableReasoningOnlyForLuna(string model, string? expectedEffort)
    {
        var handler = new CaptureHandler();
        var openai = new OpenAIClient(new ApiKeyCredential("test"), new OpenAIClientOptions
        {
            Endpoint = new Uri("https://example.invalid/v1"),
            Transport = new HttpClientPipelineTransport(new HttpClient(handler)),
        });
        using var client = openai.GetChatClient(model).AsLunaChatClient();
        await client.GetResponseAsync([new ChatMessage(ChatRole.User, "Weather?")], new ChatOptions
        {
            Tools = [AIFunctionFactory.Create(() => "sunny", "weather")],
        });
        using var request = JsonDocument.Parse(handler.Body!);
        var body = request.RootElement;
        Assert.Equal(model, body.GetProperty("model").GetString());
        Assert.Single(body.GetProperty("tools").EnumerateArray());
        if (expectedEffort is null) Assert.False(body.TryGetProperty("reasoning_effort", out _));
        else Assert.Equal(expectedEffort, body.GetProperty("reasoning_effort").GetString());
    }

    private sealed class CaptureHandler : HttpMessageHandler
    {
        public string? Body { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Body = await request.Content!.ReadAsStringAsync(token);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""
                    {"id":"chatcmpl-test","object":"chat.completion","created":1,"model":"test","choices":[{"index":0,"message":{"role":"assistant","content":"Sunny"},"finish_reason":"stop"}]}
                    """, Encoding.UTF8, "application/json"),
            };
        }
    }
}
