using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;

// Runs the real Program entry point and its configured AG-UI route. The only
// substitute is the external provider, through the starter's public base URL.
internal static class EndpointRegression
{
    private const string DisplayName = "Wire-Ada-Cedar-7f2a";
    private const string OldProverb = "Before the wire update.";
    private const string NewProverb = "After the wire update, measure twice.";
    private const string BlockedCall = "wire-answer-mutation";
    private const string Answer = "42; displayName=Wire-Ada-Cedar-7f2a";

    public static async Task RunAsync()
    {
        await using var provider = new ScriptedProvider();
        provider.Enqueue(new Reply("42"));
        provider.Enqueue(new Reply(JsonSerializer.Serialize(new { proverbs = new[] { NewProverb } })));
        provider.Enqueue(new Reply(Answer, BlockedCall));
        provider.Enqueue(new Reply("42 fallback"));

        using var host = StartProductionHost(provider.BaseUrl, out var baseUrl);
        var stdout = host.StandardOutput.ReadToEndAsync();
        var stderr = host.StandardError.ReadToEndAsync();
        try
        {
            using var client = new HttpClient(new HttpClientHandler { UseProxy = false })
            {
                BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(20),
            };
            await WaitForHostAsync(client, host);

            var ordinary = await SendAsync(client, "What is six multiplied by seven?", new { });
            Require(ordinary.Text == "42", "Ordinary endpoint answer changed");
            Require(ordinary.Count("STATE_SNAPSHOT") == 0 && ordinary.Count("STATE_DELTA") == 0,
                "Ordinary endpoint unexpectedly published state");
            Require(provider.Requests.Count == 1 && !HasSchema(provider.Requests[0]),
                "Ordinary state did not bypass the structured phase");

            const string question = "Update my proverbs, then answer six times seven and identify my displayName.";
            var structured = await SendAsync(client, question,
                new { proverbs = new[] { OldProverb }, displayName = DisplayName });

            // Real provider request payloads prove that typed RunAgentInput state
            // reached the wrapper and that the answer saw the merged result.
            // Canned transport prose cannot satisfy these independent controls.
            Require(provider.Requests.Count == 3, "Structured endpoint did not run exactly two provider phases");
            var first = provider.Requests[1];
            var second = provider.Requests[2];
            Require(HasSchema(first), "Actual endpoint lost typed state before the schema phase");
            Require(Messages(first).Any(text => ContainsState(text, OldProverb)),
                "Actual provider input lost original proverbs and displayName");
            Require(Messages(second).Count(text => ContainsState(text, NewProverb)) == 1,
                "Actual answer provider input did not contain exactly one full merged state");
            Require(Messages(second).Contains(question), "Answer provider input lost the original request");
            Require(!HasSchema(second), "Answer provider remained schema constrained");
            Require(second.TryGetProperty("tool_choice", out var toolChoice) && toolChoice.GetString() == "none",
                "Actual answer provider was not given the no-tools policy");
            Require(structured.Text == Answer, "Logical endpoint answer changed or leaked schema JSON");
            Require(structured.Events.Any(e => e.Type == "TOOL_CALL_START" &&
                    e.Value.GetProperty("toolCallId").GetString() == BlockedCall),
                "The adverse answer tool call never reached the real pipeline");
            Require(!structured.Events.Any(e => e.Type == "TOOL_CALL_RESULT" &&
                    e.Value.GetProperty("toolCallId").GetString() == BlockedCall),
                "The answer-only tool call executed");

            var fallback = await SendAsync(client, "Answer normally without editing state.",
                new { proverbs = new[] { NewProverb }, displayName = DisplayName });
            Require(provider.Requests.Count == 4 && HasSchema(provider.Requests[3]),
                "Prose fallback did not come from the single structured phase");
            Require(fallback.Text == "42 fallback" && fallback.Count("STATE_SNAPSHOT") == 0 &&
                    fallback.Count("STATE_DELTA") == 0, "Prose fallback lost its answer or published invented state");
            Require(provider.Remaining == 0 && provider.Errors.Count == 0,
                "The endpoint sent an unexpected provider request");

            // All hydration, phase, tool and fallback controls above run before
            // this intended behavioral RED on the current public wire boundary.
            Require(structured.Count("STATE_SNAPSHOT") == 1,
                $"Expected one merged STATE_SNAPSHOT on the actual HTTP/SSE route; got {structured.Count("STATE_SNAPSHOT")}");
            Require(structured.Count("STATE_DELTA") == 0, "Unexpected duplicate delta publication");
            var snapshot = structured.Events.Single(e => e.Type == "STATE_SNAPSHOT").Value.GetProperty("snapshot");
            Require(snapshot.GetProperty("displayName").GetString() == DisplayName,
                "Wire state lost the caller's unrelated displayName");
            var proverbs = snapshot.GetProperty("proverbs").EnumerateArray().Select(p => p.GetString()).ToArray();
            Require(proverbs.SequenceEqual(new[] { NewProverb }), "Wire state did not contain only the updated proverb");
            Require(structured.Events.FindIndex(e => e.Type == "STATE_SNAPSHOT") <
                    structured.Events.FindIndex(e => e.Type == "TEXT_MESSAGE_CONTENT"),
                "Wire state was published after the logical answer began");
        }
        finally
        {
            if (!host.HasExited) host.Kill(entireProcessTree: true);
            await host.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
            await Task.WhenAll(stdout, stderr).WaitAsync(TimeSpan.FromSeconds(10));
        }
    }

    private static Process StartProductionHost(string providerUrl, out string baseUrl)
    {
        baseUrl = $"http://127.0.0.1:{UnusedPort()}/";
        var testAssembly = Assembly.GetExecutingAssembly().Location;
        var testStem = Path.Combine(Path.GetDirectoryName(testAssembly)!, Path.GetFileNameWithoutExtension(testAssembly));
        var start = new ProcessStartInfo("dotnet")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(testAssembly)!,
        };
        foreach (var arg in new[] { "exec", "--runtimeconfig", testStem + ".runtimeconfig.json", "--depsfile",
            testStem + ".deps.json", typeof(ProverbsAgentFactory).Assembly.Location }) start.ArgumentList.Add(arg);
        // Do not forward provider credentials, proxy settings or startup hooks
        // from the developer/CI environment into this real application host.
        start.Environment.Clear();
        foreach (var key in new[] { "PATH", "DOTNET_ROOT", "DOTNET_ROOT_X64", "DOTNET_ROOT_ARM64", "DOTNET_ROLL_FORWARD" })
        {
            if (Environment.GetEnvironmentVariable(key) is { } value) start.Environment[key] = value;
        }
        start.Environment["NO_PROXY"] = "127.0.0.1,localhost";
        start.Environment["ASPNETCORE_URLS"] = baseUrl.TrimEnd('/');
        start.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
        start.Environment["DOTNET_ENVIRONMENT"] = "Production";
        start.Environment["OPENAI_BASE_URL"] = providerUrl;
        start.Environment["OPENAI_API_KEY"] = "endpoint-regression-dummy-key";
        start.Environment["COPILOTKIT_AGENT_MODEL"] = "openai:endpoint-script";
        return Process.Start(start) ?? throw new Exception("Could not start the actual production host");
    }

    private static async Task WaitForHostAsync(HttpClient client, Process host)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (!deadline.IsCancellationRequested)
        {
            Require(!host.HasExited, "Actual production host exited before accepting HTTP");
            try
            {
                using var response = await client.GetAsync("health", deadline.Token);
                if (response.IsSuccessStatusCode) return;
            }
            catch (HttpRequestException) { }
            await Task.Delay(50, deadline.Token);
        }
        throw new Exception("Actual production host startup timed out");
    }

    private static async Task<WireResponse> SendAsync(HttpClient client, string question, object state)
    {
        var body = JsonSerializer.Serialize(new
        {
            threadId = Guid.NewGuid().ToString(), runId = Guid.NewGuid().ToString(),
            messages = new[] { new { id = Guid.NewGuid().ToString(), role = "user", content = question } },
            state, tools = Array.Empty<object>(), context = Array.Empty<object>(), forwardedProps = new { },
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, "")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        using var response = await client.SendAsync(request);
        Require(response.StatusCode == HttpStatusCode.OK && response.Content.Headers.ContentType?.MediaType == "text/event-stream",
            "Production route did not return successful SSE");
        var raw = await response.Content.ReadAsStringAsync();
        Require(raw.Length <= 1024 * 1024, "Endpoint SSE exceeded the bounded test response");
        var events = new List<WireEvent>();
        foreach (var block in raw.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
        {
            var data = string.Join("\n", block.Split('\n').Where(line => line.StartsWith("data:", StringComparison.Ordinal))
                .Select(line => line[5..].TrimStart()));
            if (data.Length == 0) continue;
            using var json = JsonDocument.Parse(data);
            var value = json.RootElement.Clone();
            events.Add(new(value.GetProperty("type").GetString()!, value));
        }
        var result = new WireResponse(events);
        Require(result.Count("RUN_STARTED") == 1 && result.Count("RUN_FINISHED") == 1 && result.Count("RUN_ERROR") == 0,
            "Production SSE lost its successful run lifecycle");
        return result;
    }

    private static IEnumerable<string> Messages(JsonElement request)
    {
        foreach (var message in request.GetProperty("messages").EnumerateArray())
        {
            if (!message.TryGetProperty("content", out var content)) continue;
            if (content.ValueKind == JsonValueKind.String) yield return content.GetString()!;
            else if (content.ValueKind == JsonValueKind.Array)
            {
                foreach (var part in content.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var text)) yield return text.GetString()!;
                }
            }
        }
    }

    private static bool ContainsState(string text, string proverb)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end < start) return false;
        try
        {
            using var json = JsonDocument.Parse(text[start..(end + 1)]);
            var state = json.RootElement;
            return state.TryGetProperty("displayName", out var name) && name.GetString() == DisplayName &&
                state.TryGetProperty("proverbs", out var proverbs) &&
                proverbs.EnumerateArray().Select(p => p.GetString()).SequenceEqual(new[] { proverb });
        }
        catch (JsonException) { return false; }
    }

    private static bool HasSchema(JsonElement request) => request.TryGetProperty("response_format", out var format) &&
        format.TryGetProperty("type", out var type) && type.GetString() == "json_schema";

    private static int UnusedPort()
    {
        using var socket = new TcpListener(IPAddress.Loopback, 0);
        socket.Start();
        return ((IPEndPoint)socket.LocalEndpoint).Port;
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private sealed record WireEvent(string Type, JsonElement Value);
    private sealed record WireResponse(List<WireEvent> Events)
    {
        public int Count(string type) => Events.Count(e => e.Type == type);
        public string Text => string.Concat(Events.Where(e => e.Type == "TEXT_MESSAGE_CONTENT")
            .Select(e => e.Value.GetProperty("delta").GetString()));
    }
    private sealed record Reply(string Text, string? ToolCallId = null);

    private sealed class ScriptedProvider : IAsyncDisposable
    {
        private readonly HttpListener _listener = new();
        private readonly CancellationTokenSource _stop = new();
        private readonly Queue<Reply> _replies = new();
        private readonly Task _server;
        public List<JsonElement> Requests { get; } = [];
        public List<string> Errors { get; } = [];
        public int Remaining => _replies.Count;
        public string BaseUrl { get; }

        public ScriptedProvider()
        {
            var origin = $"http://127.0.0.1:{UnusedPort()}/";
            BaseUrl = origin + "v1/";
            _listener.Prefixes.Add(origin);
            _listener.Start();
            _server = ServeAsync();
        }

        public void Enqueue(Reply reply) => _replies.Enqueue(reply);

        private async Task ServeAsync()
        {
            try
            {
                while (!_stop.IsCancellationRequested)
                {
                    var context = await _listener.GetContextAsync().WaitAsync(_stop.Token);
                    try
                    {
                        Require(context.Request.HttpMethod == "POST" && context.Request.Url?.AbsolutePath == "/v1/chat/completions",
                            "Unexpected provider endpoint");
                        Require(context.Request.Headers["Authorization"] == "Bearer endpoint-regression-dummy-key",
                            "Scripted provider did not receive the explicit dummy credential");
                        using var reader = new StreamReader(context.Request.InputStream);
                        using var document = JsonDocument.Parse(await reader.ReadToEndAsync());
                        Requests.Add(document.RootElement.Clone());
                        Require(_replies.TryDequeue(out var reply), "Unexpected extra provider request");
                        var delta = new Dictionary<string, object?> { ["role"] = "assistant", ["content"] = reply!.Text };
                        if (reply.ToolCallId is { } call)
                        {
                            delta["tool_calls"] = new[] { new { index = 0, id = call, type = "function",
                                function = new { name = "add_proverbs", arguments = "{\"proverbs\":[\"Forbidden answer mutation.\"]}" } } };
                        }
                        var id = "chatcmpl-wire-" + Requests.Count;
                        string Chunk(object value, string? finish) => JsonSerializer.Serialize(new
                        {
                            id, @object = "chat.completion.chunk", created = 1, model = "endpoint-script",
                            choices = new[] { new { index = 0, delta = value, finish_reason = finish } },
                        });
                        var raw = "data: " + Chunk(delta, null) + "\n\ndata: " +
                            Chunk(new { }, reply.ToolCallId is null ? "stop" : "tool_calls") + "\n\ndata: [DONE]\n\n";
                        var bytes = Encoding.UTF8.GetBytes(raw);
                        context.Response.ContentType = "text/event-stream";
                        context.Response.StatusCode = 200;
                        context.Response.ContentLength64 = bytes.Length;
                        await context.Response.OutputStream.WriteAsync(bytes);
                    }
                    catch (Exception error)
                    {
                        Errors.Add(error.Message);
                        context.Response.StatusCode = 500;
                    }
                    finally { context.Response.Close(); }
                }
            }
            catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
            catch (HttpListenerException) when (_stop.IsCancellationRequested) { }
        }

        public async ValueTask DisposeAsync()
        {
            _stop.Cancel();
            _listener.Close();
            await _server.WaitAsync(TimeSpan.FromSeconds(5));
            _stop.Dispose();
        }
    }
}
