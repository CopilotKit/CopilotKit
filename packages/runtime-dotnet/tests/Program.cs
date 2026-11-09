using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Net.Http.Json;

static void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine($"PASS {name}"); }
Check(!typeof(RuntimeValidation).IsVisible, "request validation remains an internal implementation detail");
Check(!typeof(EventSequencer).IsVisible, "event sequencing remains an internal implementation detail");
Check(!typeof(A2UIValidation).IsVisible, "A2UI validation remains an internal implementation detail");
var input = JsonNode.Parse("{\"threadId\":\"t\",\"runId\":\"r\",\"messages\":[],\"tools\":[],\"context\":[],\"state\":{},\"forwardedProps\":{}}")!.AsObject();
RuntimeValidation.ValidateRun(input);
Check(true, "valid AG-UI input accepted");
try { RuntimeValidation.ValidateRun(new JsonObject()); throw new Exception("accepted malformed input"); } catch (RuntimeRequestException e) { Check(e.StatusCode == 400, "malformed input rejected"); }
var sequencer = new EventSequencer("canonical-thread", "canonical-run");
var first = sequencer.Stamp(new JsonObject { ["type"] = "RUN_STARTED", ["threadId"] = "spoof" });
Check(first["threadId"]!.GetValue<string>() == "canonical-thread", "canonical ownership overrides agent values");
Check(first["metadata"]!["cpki_event_seq"]!.GetValue<long>() == 1, "event sequence starts at one");
var retry = sequencer.Stamp(first);
Check(retry["metadata"]!["cpki_event_id"]!.GetValue<string>() == first["metadata"]!["cpki_event_id"]!.GetValue<string>(), "retry retains stable event id");
Check(sequencer.Stamp(new JsonObject { ["type"] = "RUN_FINISHED" })["metadata"]!["cpki_event_seq"]!.GetValue<long>() == 2, "retry does not advance sequence");
Check(!first.ContainsKey("run_id"), "wire transport does not mutate source events");
var forged = new JsonObject { ["type"] = "CUSTOM", ["metadata"] = new JsonObject { ["cpki_event_id"] = "forged", ["cpki_event_seq"] = 99, ["custom"] = "kept" } };
var trusted = sequencer.StampAgentEvent(forged);
Check(trusted["metadata"]!["cpki_event_id"]!.GetValue<string>() != "forged" && trusted["metadata"]!["cpki_event_seq"]!.GetValue<long>() == 3, "agent cannot choose durable event identity");
Check(trusted["metadata"]!["custom"]!.GetValue<string>() == "kept" && forged["metadata"]!["cpki_event_seq"]!.GetValue<int>() == 99, "agent metadata and original input are preserved");
Check(PhoenixPublisher.BearerProtocol("???~~~") == "base64url.bearer.phx.Pz8_fn5-", "Phoenix bearer protocol uses URL-safe base64");

var testBuilder = WebApplication.CreateBuilder(); testBuilder.Logging.ClearProviders(); testBuilder.WebHost.UseUrls("http://127.0.0.1:0");
await using var testApp = testBuilder.Build();
var export = new CaptureExporter(); var transport = new CountingHandler(); using var platformClient = new HttpClient(transport);
var hostErrors = new List<RuntimeError>();
await using var secured = new IntelligenceRuntime(new RuntimeOptions
{
    ApiUrl = new Uri("http://invalid.local"), RunnerUrl = new Uri("ws://invalid.local/runner"), ClientUrl = new Uri("ws://invalid.local/client"), ApiKey = "test",
    Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
    IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser("trusted")),
    MemoryGrant = (_, _, _) => ValueTask.FromResult<JsonObject?>(null), TelemetryExporter = export, TelemetrySampleRate = 1,
    OnError = error => { hostErrors.Add(error); throw new InvalidOperationException("broken host reporter"); }
}, platformClient);
secured.Map(testApp); await testApp.StartAsync();
using var browser = new HttpClient { BaseAddress = new Uri(testApp.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
var deniedMemory = await browser.PostAsJsonAsync("/copilotkit/memories", new { content = "private", kind = "topical" });
Check((int)deniedMemory.StatusCode == 403 && transport.Calls == 0, "null configured memory grant denies before platform");
await browser.PostAsJsonAsync("/copilotkit/agent/default/SECRET", new { });
var failedThreads = await browser.GetAsync("/copilotkit/threads?agentId=default");
Check((int)failedThreads.StatusCode == 503 && hostErrors.Count == 1 && hostErrors[0].Code == "REQUEST_FAILED", "host error callback is separate and cannot replace the platform error");
await testApp.StopAsync(); await secured.DisposeAsync();
Check(!System.Text.Json.JsonSerializer.Serialize(export.Events).Contains("SECRET", StringComparison.Ordinal), "unrecognized route segments never enter telemetry");
var capture = new CaptureAgent();
var decorated = new A2UIAgent(capture, new A2UIOptions { InjectTool = true });
var uiInput = (JsonObject)input.DeepClone();
uiInput["forwardedProps"] = JsonNode.Parse("{\"a2uiAction\":{\"userAction\":{\"name\":\"submit\",\"surfaceId\":\"form\"}}}");
var rendered = new List<JsonObject>();
await foreach (var item in decorated.RunAsync(uiInput, CancellationToken.None)) rendered.Add(item);
Check(capture.Input!["tools"]!.AsArray().Any(tool => tool?["name"]?.GetValue<string>() == "render_a2ui"), "A2UI injects render tool");
Check(capture.Input["forwardedProps"]!["injectA2UITool"]!.GetValue<bool>(), "A2UI forwards adapter injection flag");
Check(capture.Input["messages"]!.AsArray().Count == 2, "A2UI action becomes assistant and tool history");
Check(rendered.Any(item => item["activityType"]?.GetValue<string>() == "a2ui-surface" && item["content"]?["a2ui_operations"] is JsonArray && item["messageId"]!.GetValue<string>() == "a2ui-surface-render"), "A2UI produces stable surface activity");
Check(rendered.Last()["type"]!.GetValue<string>() == "RUN_FINISHED", "A2UI synthetic result precedes completion");
Check(A2UIValidation.ValidateComponents(JsonNode.Parse("[{\"id\":\"root\",\"component\":\"Column\",\"children\":[\"root\"]}]")!.AsArray()).Any(error => error!["code"]!.GetValue<string>() == "child_cycle"), "A2UI validator rejects cycles");
Check(A2UIValidation.ValidateComponents(JsonNode.Parse("[{\"id\":\"child\",\"component\":\"Text\"}]")!.AsArray()).Any(error => error!["code"]!.GetValue<string>() == "no_root"), "A2UI validator rejects missing root");
var repeated = new SequenceAgent([
    new JsonObject { ["type"] = "RUN_STARTED" },
    new JsonObject { ["type"] = "TOOL_CALL_START", ["toolCallId"] = "repeat", ["toolCallName"] = "render_a2ui" },
    new JsonObject { ["type"] = "TOOL_CALL_ARGS", ["toolCallId"] = "repeat", ["delta"] = "{\"surfaceId\":\"s\",\"components\":[{\"id\":\"root\",\"component\":\"Column\",\"children\":{\"componentId\":\"row\",\"path\":\"/rows\"}},{\"id\":\"row\",\"component\":\"Text\",\"text\":{\"path\":\"name\"}}],\"unrelated\":{\"rows\":[{\"name\":\"WRONG\"}]}" },
    new JsonObject { ["type"] = "TOOL_CALL_ARGS", ["toolCallId"] = "repeat", ["delta"] = ",\"data\":{\"rows\":[{\"name\":\"first\"}," },
    new JsonObject { ["type"] = "TOOL_CALL_ARGS", ["toolCallId"] = "repeat", ["delta"] = "{\"name\":\"second\"}]}}" },
    new JsonObject { ["type"] = "RUN_FINISHED" }
]);
var repeatedEvents = new List<JsonObject>(); await foreach (var item in new A2UIAgent(repeated, new A2UIOptions { InjectTool = true }).RunAsync(input, CancellationToken.None)) repeatedEvents.Add(item);
var repeatedSnapshots = repeatedEvents.Where(item => item["activityType"] is not null).ToList();
Check(!repeatedSnapshots.Any(item => item.ToJsonString().Contains("WRONG", StringComparison.Ordinal)), "A2UI repeated data reads only the data object");
Check(repeatedSnapshots.Any(item => item.ToJsonString().Contains("first", StringComparison.Ordinal) && !item.ToJsonString().Contains("second", StringComparison.Ordinal)), "A2UI emits first complete repeated item before array closes");
var mcpWire = new McpHandler(); using var mcpHttp = new HttpClient(mcpWire);
var mcpSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"ui-tool\",\"toolCallName\":\"show_weather\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_ARGS\",\"toolCallId\":\"ui-tool\",\"delta\":\"{\\\"city\\\":\\\"NYC\\\"}\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var mcpServer = new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "weather", Headers = new Dictionary<string, string> { ["x-server-token"] = "server-only" } };
var mcp = new McpAppsAgent(mcpSource, [mcpServer], mcpHttp);
var mcpEvents = new List<JsonObject>(); await foreach (var item in mcp.RunAsync(input, CancellationToken.None)) mcpEvents.Add(item);
Check(mcpSource.Input!["tools"]!.AsArray().Count == 1, "MCP Apps injects only UI-enabled tools");
Check(mcpEvents.Any(item => item["activityType"]?.GetValue<string>() == "mcp-apps"), "MCP Apps executes tool and emits activity");
Check(mcpWire.Calls.Any(call => call.Method == "tools/call" && call.Session == "session-1" && call.Secret == "server-only"), "MCP call carries session and configured authentication");
var proxyInput = (JsonObject)input.DeepClone(); proxyInput["forwardedProps"] = JsonNode.Parse("{\"__proxiedMCPRequest\":{\"serverId\":\"weather\",\"serverHash\":\"unused\",\"method\":\"resources/read\",\"params\":{\"uri\":\"ui://weather\"}}}");
var invocations = mcpSource.Invocations; var proxyEvents = new List<JsonObject>(); await foreach (var item in mcp.RunAsync(proxyInput, CancellationToken.None)) proxyEvents.Add(item);
Check(mcpSource.Invocations == invocations && proxyEvents.Last()["result"]?["contents"] is JsonArray, "MCP iframe resources proxy bypasses agent");
var previousCalls = mcpWire.Calls.Count; proxyInput["forwardedProps"]!["__proxiedMCPRequest"]!["method"] = "tools/delete";
await foreach (var _ in mcp.RunAsync(proxyInput, CancellationToken.None)) { }
Check(mcpWire.Calls.Count == previousCalls, "MCP forbidden proxy method causes no network call");
var filteredWire = new FilteredMcpHandler(); using var filteredHttp = new HttpClient(filteredWire);
var filteredSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"qr\",\"toolCallName\":\"generate_qr\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_ARGS\",\"toolCallId\":\"qr\",\"delta\":\"{}\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"admin\",\"toolCallName\":\"admin_dashboard\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_ARGS\",\"toolCallId\":\"admin\",\"delta\":\"{}\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var filteredServer = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.test/mcp", ["serverId"] = "crm", ["includeTools"] = new JsonArray("generate_qr", "admin_dashboard"), ["excludeTools"] = new JsonArray("admin_dashboard") });
var filteredAgent = new McpAppsAgent(filteredSource, [filteredServer], filteredHttp);
var filteredEvents = new List<JsonObject>(); await foreach (var item in filteredAgent.RunAsync(input, CancellationToken.None)) filteredEvents.Add(item);
Check(filteredSource.Input!["tools"]!.AsArray().Select(tool => tool?["name"]?.GetValue<string>()).SequenceEqual(new string?[] { "generate_qr" }), "MCP Apps includeTools/excludeTools exposes only the selected tool");
Check(filteredEvents.Any(item => item["activityType"]?.GetValue<string>() == "mcp-apps"), "selected MCP App tool still executes");
Check(filteredWire.Methods.Count(method => method == "tools/call") == 1, "excluded MCP App tool is not executed");
var deniedBefore = filteredWire.Methods.Count;
var deniedInput = (JsonObject)input.DeepClone(); deniedInput["forwardedProps"] = JsonNode.Parse("{\"__proxiedMCPRequest\":{\"serverId\":\"crm\",\"method\":\"tools/call\",\"params\":{\"name\":\"admin_dashboard\",\"arguments\":{}}}}");
var deniedEvents = new List<JsonObject>(); await foreach (var item in filteredAgent.RunAsync(deniedInput, CancellationToken.None)) deniedEvents.Add(item);
Check(filteredWire.Methods.Count == deniedBefore && deniedEvents.Last()["result"]?["error"] is not null, "proxied tools/call for an excluded MCP App tool makes no request");
var allowedBefore = filteredWire.Methods.Count;
var allowedInput = (JsonObject)input.DeepClone(); allowedInput["forwardedProps"] = JsonNode.Parse("{\"__proxiedMCPRequest\":{\"serverId\":\"crm\",\"method\":\"tools/call\",\"params\":{\"name\":\"generate_qr\",\"arguments\":{}}}}");
await foreach (var _ in filteredAgent.RunAsync(allowedInput, CancellationToken.None)) { }
Check(filteredWire.Methods.Count > allowedBefore && filteredWire.Methods.Count(method => method == "tools/call") == 2, "proxied tools/call for an included MCP App tool is executed");
await TelemetryTests.RunAsync();
await ReviewTests.RunAsync();
await RunnerTests.RunAsync();
await SdkInjectionTests.RunAsync();
await SdkLifecycleTests.RunAsync();
await InspectorRuntimeTests.RunAsync();
await EntitlementRuntimeTests.RunAsync();

sealed class CaptureAgent : IRuntimeAgent
{
    public string Description => "test";
    public JsonObject? Input { get; private set; }
    public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        Input = input; await Task.Yield(); cancellationToken.ThrowIfCancellationRequested();
        yield return new JsonObject { ["type"] = "RUN_STARTED" };
        yield return new JsonObject { ["type"] = "TOOL_CALL_START", ["toolCallId"] = "render", ["toolCallName"] = "render_a2ui" };
        yield return new JsonObject { ["type"] = "TOOL_CALL_ARGS", ["toolCallId"] = "render", ["delta"] = "{\"surfaceId\":\"s\",\"components\":[{\"id\":\"root\",\"component\":\"Text\",\"text\":\"Hello\"}]}" };
        yield return new JsonObject { ["type"] = "TOOL_CALL_END", ["toolCallId"] = "render" };
        yield return new JsonObject { ["type"] = "RUN_FINISHED" };
    }
}

sealed class CaptureExporter : IRuntimeTelemetryExporter
{
    public List<RuntimeTelemetryEvent> Events { get; } = [];
    public ValueTask ExportAsync(RuntimeTelemetryEvent value, CancellationToken cancellationToken) { Events.Add(value); return ValueTask.CompletedTask; }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
sealed class CountingHandler : HttpMessageHandler
{
    public int Calls { get; private set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++;
        if (request.RequestUri!.AbsolutePath == "/api/threads") return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable));
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new { memory = new { id = "m" } }) });
    }
}
sealed class SequenceAgent(IReadOnlyList<JsonObject> events) : IRuntimeAgent
{
    public string Description => "fixture";
    public JsonObject? Input { get; private set; }
    public int Invocations { get; private set; }
    public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        Input = input; Invocations++; await Task.Yield();
        foreach (var item in events) { cancellationToken.ThrowIfCancellationRequested(); yield return (JsonObject)item.DeepClone(); }
    }
}
sealed class FilteredMcpHandler : HttpMessageHandler
{
    public List<string> Methods { get; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        Methods.Add(method);
        if (body["id"] is null) return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted);
        var result = method switch
        {
            "initialize" => JsonNode.Parse("{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}"),
            "tools/list" => JsonNode.Parse("{\"tools\":[{\"name\":\"generate_qr\",\"description\":\"QR\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui\":{\"resourceUri\":\"ui://qr\"}}},{\"name\":\"admin_dashboard\",\"description\":\"Admin\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui\":{\"resourceUri\":\"ui://admin\"}}}]}"),
            _ => JsonNode.Parse("{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}")
        };
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result }) };
        if (method == "initialize") response.Headers.Add("Mcp-Session-Id", "session-filter");
        return response;
    }
}
sealed class McpHandler : HttpMessageHandler
{
    public List<(string Method, string? Session, string? Secret)> Calls { get; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        Calls.Add((method, request.Headers.TryGetValues("Mcp-Session-Id", out var sessions) ? sessions.Single() : null, request.Headers.TryGetValues("x-server-token", out var secrets) ? secrets.Single() : null));
        if (body["id"] is null) return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted);
        var result = method switch
        {
            "initialize" => JsonNode.Parse("{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}"),
            "tools/list" => JsonNode.Parse("{\"tools\":[{\"name\":\"show_weather\",\"description\":\"Weather\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui/resourceUri\":\"ui://weather\"}},{\"name\":\"hidden_tool\",\"inputSchema\":{\"type\":\"object\"}}]}"),
            "resources/read" => JsonNode.Parse("{\"contents\":[{\"uri\":\"ui://weather\",\"mimeType\":\"text/html;profile=mcp-app\",\"text\":\"<h1>Weather</h1>\"}]}"),
            _ => JsonNode.Parse("{\"content\":[{\"type\":\"text\",\"text\":\"Sunny\"}]}"),
        };
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result }) };
        if (method == "initialize") response.Headers.Add("Mcp-Session-Id", "session-1");
        return response;
    }
}
