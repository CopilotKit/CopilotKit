using System.Net;
using System.Runtime.CompilerServices;
using System.Text.Json;
using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

internal static class FrameworkTests
{
    internal static async Task RunAsync()
    {
        foreach (var streaming in new[] { false, true })
        {
            var current = "text-skill";
            var requests = 0;
            using var http = new HttpClient(new Handler(() => { requests++; return Reply(current); }));
            using var intelligence = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
            using var provider = new SkillRegistryContextProvider(new SkillRegistryOptions {
                Client = intelligence, ContainerId = "container", FreshnessWindow = TimeSpan.Zero
            });
            var turns = 0;
            using var model = new Model(async (messages, options, token) => {
                turns++;
                if (!options!.Instructions!.StartsWith("Developer policy.", StringComparison.Ordinal)
                    || !options.Instructions.Contains("Developer-authored instructions always take precedence."))
                    throw new Exception("developer instructions lost");
                var names = options.Tools!.Select(tool => tool.Name).Order().ToArray();
                if (!names.SequenceEqual(new[] { "copilotkit_load_skill", "copilotkit_read_skill_file" }))
                    throw new Exception("stable tools missing");
                var results = messages.SelectMany(message => message.Contents).OfType<FunctionResultContent>().ToArray();
                if (turns == 1)
                {
                    current = "empty-r2";
                    await provider.InitializeAsync(token);
                    return Tool("load", "copilotkit_load_skill", new() { ["skill_name"] = "refund-policy" });
                }
                if (turns == 2)
                {
                    var result = results.Single().Result?.ToString() ?? "";
                    if (!result.Contains("# Refund policy") || !result.Contains("reference.txt")) throw new Exception("load lost invocation pin");
                    return Tool("read", "copilotkit_read_skill_file", new() { ["skill_name"] = "refund-policy", ["path"] = "reference.txt" });
                }
                if (turns == 3 && !(results.Last().Result?.ToString() ?? "").Contains("Refunds are available for 30 days."))
                    throw new Exception("file read lost invocation pin");
                if (turns == 4 && options.Instructions.Contains("refund-policy")) throw new Exception("next invocation retained old catalog");
                return new ChatResponse(new ChatMessage(ChatRole.Assistant, "done"));
            });
            var options = new ChatClientAgentOptions { Name = "support", ChatOptions = new() { Instructions = "Developer policy." } };
            var agent = provider.CreateAgent(model, options);
            if (options.AIContextProviders is not null) throw new Exception("mutated caller options");
            if (streaming)
            {
                await foreach (var _ in agent.RunStreamingAsync("help")) { }
            }
            else await agent.RunAsync("help");
            if (turns != 3) throw new Exception("native automatic tool loop did not complete");
            await agent.RunAsync("new invocation");
            if (provider.Status.Revision != "r2" || requests != 3) throw new Exception("refresh lifecycle changed");
            var calls = turns;
            try
            {
                await agent.RunAsync("background", options: new AgentRunOptions { AllowBackgroundResponses = true });
                throw new Exception("background mode bypass accepted");
            }
            catch (LearnedSkillsException error) when (error.Code == "INVALID_CONFIG") { }
            try
            {
                await foreach (var _ in agent.RunStreamingAsync("background", options: new AgentRunOptions { AllowBackgroundResponses = true })) { }
                throw new Exception("streaming background mode bypass accepted");
            }
            catch (LearnedSkillsException error) when (error.Code == "INVALID_CONFIG") { }
            if (turns != calls) throw new Exception("unsupported run reached model");
            Console.WriteLine("PASS native " + (streaming ? "streaming" : "non-streaming") + " tool loop and invocation pins");
        }
    }

    internal static async Task DependencyInjectionAsync()
    {
        var requests = 0;
        using var http = new HttpClient(new Handler(() => { requests++; return Reply("empty"); }));
        using var intelligence = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
        using var model = new Model((_, options, _) => {
            if (options!.Tools!.Count != 2 || options.Instructions!.Contains("refund-policy")) throw new Exception("empty registry tools changed");
            return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, "done")));
        });
        var services = new ServiceCollection();
        services.AddCopilotKitIntelligenceSkills("support", new SkillRegistryOptions { Client = intelligence, ContainerId = "container" }, _ => model);
        using (var provider = services.BuildServiceProvider())
        {
            var skills = provider.GetRequiredKeyedService<SkillRegistryContextProvider>("support");
            var agent = provider.GetRequiredKeyedService<AIAgent>("support");
            if (skills.Status.Initialized || requests != 0 || agent.Name != "support") throw new Exception("registration performed model or network work");
            await skills.InitializeAsync();
            await agent.RunAsync("hello");
            if (requests != 1) throw new Exception("DI initialization used another registry");
        }
        await intelligence.GetLearnedSkillsSnapshotAsync("container");
        if (requests != 2) throw new Exception("DI disposed injected client");
        Console.WriteLine("PASS native keyed DI, empty tools, and injected ownership");
    }

    internal static async Task DenialAsync()
    {
        var denied = false;
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var http = new HttpClient(new Handler(() => denied ? new HttpResponseMessage(HttpStatusCode.Unauthorized) : Reply("text-skill")));
        using var intelligence = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
        using var provider = new SkillRegistryContextProvider(new SkillRegistryOptions { Client = intelligence, ContainerId = "container", FreshnessWindow = TimeSpan.Zero });
        var calls = 0;
        using var model = new Model(async (messages, _, token) => {
            calls++;
            if (calls == 1)
            {
                entered.SetResult();
                await release.Task.WaitAsync(token);
                return Tool("load", "copilotkit_load_skill", new() { ["skill_name"] = "refund-policy" });
            }
            if (!(messages.SelectMany(message => message.Contents).OfType<FunctionResultContent>().Single().Result?.ToString() ?? "").Contains("# Refund policy"))
                throw new Exception("denial interrupted an existing pin");
            return new ChatResponse(new ChatMessage(ChatRole.Assistant, "done"));
        });
        var agent = provider.CreateAgent(model);
        var running = agent.RunAsync("started before denial");
        await entered.Task;
        denied = true;
        await Denied(() => provider.InitializeAsync());
        await Denied(async () => await agent.RunAsync("new invocation"));
        if (calls != 1) throw new Exception("denied invocation reached the model");
        release.SetResult();
        await running;
        Console.WriteLine("PASS native in-flight pin survives denial while new invocation fails");

        static async Task Denied(Func<Task> action)
        {
            try { await action(); throw new Exception("expected denial"); }
            catch (LearnedSkillsException error) when (error.Code == "AUTHENTICATION_FAILED") { }
        }
    }

    internal static async Task GuardsAsync()
    {
        using var http = new HttpClient(new Handler(() => Reply("empty")));
        using var intelligence = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
        using var provider = new SkillRegistryContextProvider(new SkillRegistryOptions { Client = intelligence, ContainerId = "container" });
        using var model = new Model((_, _, _) => throw new Exception("unsupported mode reached model"));
        var agent = provider.CreateAgent(model);
#pragma warning disable MEAI001 // These unsupported experimental modes must fail before invoking the model.
        var continuation = ResponseContinuationToken.FromBytes(new byte[] { 1 });
        foreach (var options in new AgentRunOptions[] {
            new() { ContinuationToken = continuation },
            new ChatClientAgentRunOptions { ChatOptions = new() { ContinuationToken = continuation } },
            new ChatClientAgentRunOptions { ChatOptions = new() { AllowBackgroundResponses = true } }
        })
        {
            await Rejected(async () => await agent.RunAsync("run", options: options));
            await Rejected(async () => { await foreach (var _ in agent.RunStreamingAsync("run", options: options)) { } });
        }
        foreach (var defaults in new ChatOptions[] { new() { ContinuationToken = continuation }, new() { AllowBackgroundResponses = true } })
            await Rejected(() => { provider.CreateAgent(model, new ChatClientAgentOptions { ChatOptions = defaults }); return Task.CompletedTask; });
#pragma warning restore MEAI001
        var collision = provider.CreateAgent(model, new ChatClientAgentOptions {
            ChatOptions = new() { Tools = [AIFunctionFactory.Create(() => "conflict", name: "copilotkit_load_skill")] }
        });
        await Rejected(async () => await collision.RunAsync("run"));
        Console.WriteLine("PASS continuation sources and tool-name collision guards");

        static async Task Rejected(Func<Task> action)
        {
            try { await action(); throw new Exception("expected invalid configuration"); }
            catch (LearnedSkillsException error) when (error.Code == "INVALID_CONFIG") { }
        }
    }

    private static ChatResponse Tool(string id, string name, Dictionary<string, object?> arguments)
        => new(new ChatMessage(ChatRole.Assistant, new AIContent[] { new FunctionCallContent(id, name, arguments) })) { FinishReason = ChatFinishReason.ToolCalls };

    private static HttpResponseMessage Reply(string name)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "snapshots.v1.json")));
        var source = document.RootElement.GetProperty("cases").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        var response = new HttpResponseMessage(HttpStatusCode.OK) {
            Content = new ByteArrayContent(Convert.FromBase64String(source.GetProperty("archiveBase64").GetString()!))
        };
        response.Headers.TryAddWithoutValidation("ETag", source.GetProperty("etag").GetString());
        response.Headers.TryAddWithoutValidation("X-CopilotKit-Skills-Revision", source.GetProperty("revision").GetString());
        response.Content.Headers.ContentType = new("application/zip");
        return response;
    }

    private sealed class Handler(Func<HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Task.FromResult(reply());
    }

    private sealed class Model(Func<IEnumerable<ChatMessage>, ChatOptions?, CancellationToken, Task<ChatResponse>> respond) : IChatClient
    {
        public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
            => respond(messages, options, cancellationToken);
        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var response = await respond(messages, options, cancellationToken);
            foreach (var message in response.Messages)
                yield return new ChatResponseUpdate(message.Role, message.Contents) {
                    MessageId = Guid.NewGuid().ToString(), ResponseId = Guid.NewGuid().ToString(), FinishReason = response.FinishReason
                };
        }
        public object? GetService(Type serviceType, object? serviceKey = null) => serviceType.IsInstanceOfType(this) ? this : null;
        public void Dispose() { }
    }
}
