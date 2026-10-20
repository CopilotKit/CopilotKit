using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.Extensions.AI;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

// Host the actual Microsoft Agent Framework AG-UI endpoint on .NET 8.
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddAGUIServer();
await using var app = builder.Build();
using var chat = new FixtureChatClient();
var agent = new ChatClientAgent(chat);
app.MapAGUIServer("/agent", agent);
await app.StartAsync();
try
{
    var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
    using var http = new HttpClient();
    var runtimeAgent = new HttpAgent(new Uri(address + "/agent"), http);
    var input = JsonNode.Parse("""{"threadId":"framework-thread","runId":"framework-run","messages":[{"id":"user-message","role":"user","content":"hello"}],"tools":[],"context":[],"state":{},"forwardedProps":{}}""")!.AsObject();
    var events = new List<JsonObject>();
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    await foreach (var item in runtimeAgent.RunAsync(input, timeout.Token)) events.Add(item);
    if (!events.Any(e => e["type"]?.GetValue<string>() == "RUN_STARTED")
        || !events.Any(e => e["type"]?.GetValue<string>() == "TEXT_MESSAGE_CONTENT" && e["delta"]?.GetValue<string>() == "Hello from Agent Framework")
        || events.Last()["type"]?.GetValue<string>() != "RUN_FINISHED")
        throw new Exception("Agent Framework did not produce a complete AG-UI response");
    Console.WriteLine("PASS .NET 8 runtime HTTP agent consumes a real Agent Framework AG-UI endpoint");
}
finally { await app.StopAsync(); }

// The model is deterministic; Agent Framework owns its real routing and AG-UI stream.
sealed class FixtureChatClient : IChatClient
{
    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        => Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, "Hello from Agent Framework")));
    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.Yield();
        cancellationToken.ThrowIfCancellationRequested();
        yield return new ChatResponseUpdate(ChatRole.Assistant, "Hello from Agent Framework") { MessageId = "assistant-message", ResponseId = "fixture-response", FinishReason = ChatFinishReason.Stop };
    }
    public object? GetService(Type serviceType, object? serviceKey = null) => serviceType.IsInstanceOfType(this) ? this : null;
    public void Dispose() { }
}
