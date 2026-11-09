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
var uiToolCalls = mcpWire.Calls.Count(call => call.Method == "tools/call");
var hiddenProxy = (JsonObject)input.DeepClone(); hiddenProxy["forwardedProps"] = JsonNode.Parse("{\"__proxiedMCPRequest\":{\"serverId\":\"weather\",\"method\":\"tools/call\",\"params\":{\"name\":\"hidden_tool\",\"arguments\":{}}}}");
var hiddenEvents = new List<JsonObject>(); await foreach (var item in mcp.RunAsync(hiddenProxy, CancellationToken.None)) hiddenEvents.Add(item);
Check(mcpWire.Calls.Count(call => call.Method == "tools/call") == uiToolCalls + 1 && hiddenEvents.Last()["result"]?["isError"] is null, "unfiltered proxy forwards a non-UI tool without discovery");
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
Check(filteredWire.Methods.Count(method => method == "tools/call") == 1 && filteredWire.ToolCalls.SequenceEqual(new[] { "generate_qr" }), "the only executed MCP tool is generate_qr");
var adminResult = -1; var finished = -1;
for (var index = 0; index < filteredEvents.Count; index++)
{
    if (filteredEvents[index]["type"]?.GetValue<string>() == "TOOL_CALL_RESULT" && filteredEvents[index]["toolCallId"]?.GetValue<string>() == "admin") adminResult = index;
    if (filteredEvents[index]["type"]?.GetValue<string>() == "RUN_FINISHED") finished = index;
}
Check(adminResult >= 0 && finished > adminResult && filteredEvents[adminResult]["content"]?.GetValue<string>() == "MCP tool is not allowed: admin_dashboard", "excluded MCP tool call is rejected before RUN_FINISHED");
var deniedInput = (JsonObject)input.DeepClone(); deniedInput["forwardedProps"] = JsonNode.Parse("{\"__proxiedMCPRequest\":{\"serverId\":\"crm\",\"method\":\"tools/call\",\"params\":{\"name\":\"admin_dashboard\",\"arguments\":{}}}}");
var deniedEvents = new List<JsonObject>(); await foreach (var item in filteredAgent.RunAsync(deniedInput, CancellationToken.None)) deniedEvents.Add(item);
Check(!filteredWire.ToolCalls.Contains("admin_dashboard") && deniedEvents.Last()["result"]?["isError"]?.GetValue<bool>() == true && deniedEvents.Last()["result"]?["content"]?[0]?["text"]?.GetValue<string>()?.Contains("admin_dashboard") == true, "proxied tools/call for an excluded MCP App tool is not forwarded");
var allowedBefore = filteredWire.Methods.Count;
var allowedInput = (JsonObject)input.DeepClone(); allowedInput["forwardedProps"] = JsonNode.Parse("{\"__proxiedMCPRequest\":{\"serverId\":\"crm\",\"method\":\"tools/call\",\"params\":{\"name\":\"generate_qr\",\"arguments\":{}}}}");
await foreach (var _ in filteredAgent.RunAsync(allowedInput, CancellationToken.None)) { }
Check(filteredWire.Methods.Count > allowedBefore && filteredWire.ToolCalls.SequenceEqual(new[] { "generate_qr", "generate_qr" }), "proxied tools/call for an included MCP App tool is executed");
var emptyWire = new FilteredMcpHandler(); using var emptyHttp = new HttpClient(emptyWire);
var emptySource = new SequenceAgent([JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(), JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()]);
var emptyServer = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.test/mcp", ["serverId"] = "crm", ["includeTools"] = new JsonArray() });
await foreach (var _ in new McpAppsAgent(emptySource, [emptyServer], emptyHttp).RunAsync(input, CancellationToken.None)) { }
Check(emptyWire.Methods.Count == 0 && emptySource.Input!["tools"]!.AsArray().Count == 0, "empty includeTools skips MCP discovery");
var wideWire = new WideMcpHandler(1001, true, false); using var wideHttp = new HttpClient(wideWire);
var wideSource = new SequenceAgent([JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(), JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()]);
var wideServer = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.test/mcp", ["serverId"] = "wide", ["includeTools"] = new JsonArray("wanted") });
await foreach (var _ in new McpAppsAgent(wideSource, [wideServer], wideHttp).RunAsync(input, CancellationToken.None)) { }
Check(wideWire.Lists == 1 && wideSource.Input!["tools"]!.AsArray().Any(tool => tool?["name"]?.GetValue<string>() == "wanted"), "configured tool past the scan cutoff is still discovered");
var cappedReports = new List<string>(); var cappedWire = new WideMcpHandler(2000, false, true); using var cappedHttp = new HttpClient(cappedWire);
var cappedSource = new SequenceAgent([JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(), JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()]);
var cappedServer = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.test/mcp", ["serverId"] = "capped", ["includeTools"] = new JsonArray("wanted") });
await foreach (var _ in new McpAppsAgent(cappedSource, [cappedServer], cappedHttp, cappedReports.Add).RunAsync(input, CancellationToken.None)) { }
Check(cappedWire.Lists == 1 && cappedSource.Input!["tools"]!.AsArray().Count == 0 && cappedReports.Contains("mcp.discovery_incomplete"), "scan cap reports incomplete discovery");
var emptyCallSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"admin\",\"toolCallName\":\"admin_dashboard\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var emptyCallEvents = new List<JsonObject>(); await foreach (var item in new McpAppsAgent(emptyCallSource, [emptyServer], emptyHttp).RunAsync(input, CancellationToken.None)) emptyCallEvents.Add(item);
var emptyRejected = -1; var emptyFinished = -1;
for (var index = 0; index < emptyCallEvents.Count; index++)
{
    if (emptyCallEvents[index]["toolCallId"]?.GetValue<string>() == "admin" && emptyCallEvents[index]["type"]?.GetValue<string>() == "TOOL_CALL_RESULT") emptyRejected = index;
    if (emptyCallEvents[index]["type"]?.GetValue<string>() == "RUN_FINISHED") emptyFinished = index;
}
Check(emptyRejected >= 0 && emptyFinished > emptyRejected, "empty includeTools still rejects the model call before RUN_FINISHED");
var ownedInput = (JsonObject)input.DeepClone(); ownedInput["tools"] = new JsonArray(new JsonObject { ["name"] = "admin_dashboard", ["description"] = "frontend", ["parameters"] = new JsonObject { ["type"] = "object" } });
var ownedEvents = new List<JsonObject>(); await foreach (var item in new McpAppsAgent(emptyCallSource, [emptyServer], emptyHttp).RunAsync(ownedInput, CancellationToken.None)) ownedEvents.Add(item);
Check(!ownedEvents.Any(item => item["type"]?.GetValue<string>() == "TOOL_CALL_RESULT" && item["content"]?.GetValue<string>()?.Contains("not allowed") == true), "frontend tool is not denied when an MCP allowlist is empty");
var sharedWire = new SharedNameHandler(); using var sharedHttp = new HttpClient(sharedWire);
var sharedSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"a\",\"toolCallName\":\"show_weather\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_ARGS\",\"toolCallId\":\"a\",\"delta\":\"{}\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"b\",\"toolCallName\":\"beta__show_weather\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_ARGS\",\"toolCallId\":\"b\",\"delta\":\"{}\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var alpha = new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "alpha", Headers = new Dictionary<string, string> { ["x-token"] = "alpha" } };
var beta = new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "beta", Headers = new Dictionary<string, string> { ["x-token"] = "beta" } };
await foreach (var _ in new McpAppsAgent(sharedSource, [alpha, beta], sharedHttp).RunAsync(input, CancellationToken.None)) { }
var sharedNames = sharedSource.Input!["tools"]!.AsArray().Select(tool => tool?["name"]?.GetValue<string>()).ToArray();
Check(sharedNames.SequenceEqual(new string?[] { "show_weather", "beta__show_weather" }), "colliding MCP tools get distinct exposed names");
Check(sharedWire.ToolCalls.SequenceEqual(new[] { ("alpha", "show_weather"), ("beta", "show_weather") }), "each exposed name calls its own server");
var flakyWire = new FlakyListHandler(); using var flakyHttp = new HttpClient(flakyWire);
var flakySource = new SequenceAgent([JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(), JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()]);
var flakyServer = new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "flaky" };
var flakyAgent = new McpAppsAgent(flakySource, [flakyServer], flakyHttp);
await foreach (var _ in flakyAgent.RunAsync(input, CancellationToken.None)) { }
Check(flakySource.Input!["tools"]!.AsArray().Count == 0, "failed discovery exposes no tools");
var failedProxy = (JsonObject)input.DeepClone(); failedProxy["forwardedProps"] = JsonNode.Parse("{\"__proxiedMCPRequest\":{\"serverId\":\"flaky\",\"method\":\"tools/call\",\"params\":{\"name\":\"generate_qr\",\"arguments\":{}}}}");
var failedEvents = new List<JsonObject>(); await foreach (var item in flakyAgent.RunAsync(failedProxy, CancellationToken.None)) failedEvents.Add(item);
Check(failedEvents.Last()["result"]?["error"] is null && flakyWire.Lists == 1, "unfiltered proxy does not replace a call with a discovery error");
await foreach (var _ in flakyAgent.RunAsync(input, CancellationToken.None)) { }
Check(flakySource.Input!["tools"]!.AsArray().Any(tool => tool?["name"]?.GetValue<string>() == "generate_qr"), "a later run retries discovery after the server recovers");
var filteredFlakyWire = new FlakyListHandler(); using var filteredFlakyHttp = new HttpClient(filteredFlakyWire);
var filteredFlakyServer = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.test/mcp", ["serverId"] = "filtered-flaky", ["includeTools"] = new JsonArray("generate_qr") });
var filteredFlakyAgent = new McpAppsAgent(new SequenceAgent([JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(), JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()]), [filteredFlakyServer], filteredFlakyHttp);
var filteredFailedProxy = (JsonObject)input.DeepClone(); filteredFailedProxy["forwardedProps"] = JsonNode.Parse("{\"__proxiedMCPRequest\":{\"serverId\":\"filtered-flaky\",\"method\":\"tools/call\",\"params\":{\"name\":\"generate_qr\",\"arguments\":{}}}}");
var filteredFailedEvents = new List<JsonObject>(); await foreach (var item in filteredFlakyAgent.RunAsync(filteredFailedProxy, CancellationToken.None)) filteredFailedEvents.Add(item);
Check(filteredFailedEvents.Last()["result"]?["error"] is not null && filteredFailedEvents.Last()["result"]?["isError"] is null, "filtered discovery failure is a proxy failure, not a denial");
var cappedCallSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"wanted\",\"toolCallName\":\"wanted\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var cappedCallEvents = new List<JsonObject>(); await foreach (var item in new McpAppsAgent(cappedCallSource, [cappedServer], cappedHttp, cappedReports.Add).RunAsync(input, CancellationToken.None)) cappedCallEvents.Add(item);
var wantedResult = -1; var wantedFinished = -1;
for (var index = 0; index < cappedCallEvents.Count; index++)
{
    if (cappedCallEvents[index]["toolCallId"]?.GetValue<string>() == "wanted" && cappedCallEvents[index]["type"]?.GetValue<string>() == "TOOL_CALL_RESULT") wantedResult = index;
    if (cappedCallEvents[index]["type"]?.GetValue<string>() == "RUN_FINISHED") wantedFinished = index;
}
Check(wantedResult >= 0 && wantedFinished > wantedResult && cappedCallEvents[wantedResult]["content"]?.GetValue<string>() == "MCP tool discovery failed: wanted", "unseen configured tool gets a discovery error before RUN_FINISHED");
var pagedWire = new PagedFailHandler(); using var pagedHttp = new HttpClient(pagedWire);
var pagedSource = new SequenceAgent([JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(), JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()]);
await foreach (var _ in new McpAppsAgent(pagedSource, [new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "paged" }], pagedHttp).RunAsync(input, CancellationToken.None)) { }
Check(pagedWire.Lists == 2 && pagedSource.Input!["tools"]!.AsArray().Count == 0, "a failed later page discards tools from earlier pages");
var reservedWire = new SharedNameHandler(); using var reservedHttp = new HttpClient(reservedWire);
var reservedSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"front\",\"toolCallName\":\"show_weather\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var reservedInput = (JsonObject)input.DeepClone(); reservedInput["tools"] = new JsonArray(new JsonObject { ["name"] = "show_weather", ["description"] = "frontend", ["parameters"] = new JsonObject { ["type"] = "object" } });
await foreach (var _ in new McpAppsAgent(reservedSource, [new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "alpha", Headers = new Dictionary<string, string> { ["x-token"] = "alpha" } }], reservedHttp).RunAsync(reservedInput, CancellationToken.None)) { }
var reservedNames = reservedSource.Input!["tools"]!.AsArray().Select(tool => tool?["name"]?.GetValue<string>()).ToArray();
Check(reservedNames.Contains("show_weather") && reservedNames.Contains("alpha__show_weather") && reservedWire.ToolCalls.Count == 0, "frontend names are reserved before MCP tools are exposed");
var slashWire = new SharedNameHandler(); using var slashHttp = new HttpClient(slashWire);
var slashSource = new SequenceAgent([JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(), JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()]);
await foreach (var _ in new McpAppsAgent(slashSource, [alpha, new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "billing/eu", Headers = new Dictionary<string, string> { ["x-token"] = "eu" } }], slashHttp).RunAsync(input, CancellationToken.None)) { }
var slashName = slashSource.Input!["tools"]!.AsArray().Select(tool => tool?["name"]?.GetValue<string>()).Last();
Check(slashName is not null && System.Text.RegularExpressions.Regex.IsMatch(slashName, "^[A-Za-z0-9_-]{1,64}$") && !slashName.Contains('/'), "collision names stay within provider tool-name rules");
var nonUiWire = new NonUiFilterHandler(); using var nonUiHttp = new HttpClient(nonUiWire);
var nonUiSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"admin\",\"toolCallName\":\"admin_dashboard\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var nonUiServer = McpAppServer.FromJson(new JsonObject { ["url"] = "https://mcp.test/mcp", ["serverId"] = "crm", ["includeTools"] = new JsonArray("generate_qr") });
var nonUiEvents = new List<JsonObject>(); await foreach (var item in new McpAppsAgent(nonUiSource, [nonUiServer], nonUiHttp).RunAsync(input, CancellationToken.None)) nonUiEvents.Add(item);
var nonUiRejected = -1; var nonUiFinished = -1;
for (var index = 0; index < nonUiEvents.Count; index++)
{
    if (nonUiEvents[index]["toolCallId"]?.GetValue<string>() == "admin" && nonUiEvents[index]["type"]?.GetValue<string>() == "TOOL_CALL_RESULT") nonUiRejected = index;
    if (nonUiEvents[index]["type"]?.GetValue<string>() == "RUN_FINISHED") nonUiFinished = index;
}
Check(nonUiSource.Input!["tools"]!.AsArray().All(tool => tool?["name"]?.GetValue<string>() != "admin_dashboard") && nonUiRejected >= 0 && nonUiFinished > nonUiRejected && nonUiEvents[nonUiRejected]["content"]?.GetValue<string>() == "MCP tool is not allowed: admin_dashboard", "allowlist omits a non-UI tool call before RUN_FINISHED");
var lostWire = new PagedFailHandler(); using var lostHttp = new HttpClient(lostWire);
var lostSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"seen\",\"toolCallName\":\"show_weather\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var lostServer = new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "exclude-only", ExcludeTools = new[] { "other" } };
var lostEvents = new List<JsonObject>(); await foreach (var item in new McpAppsAgent(lostSource, [lostServer], lostHttp).RunAsync(input, CancellationToken.None)) lostEvents.Add(item);
var lostResult = -1; var lostFinished = -1;
for (var index = 0; index < lostEvents.Count; index++)
{
    if (lostEvents[index]["toolCallId"]?.GetValue<string>() == "seen" && lostEvents[index]["type"]?.GetValue<string>() == "TOOL_CALL_RESULT") lostResult = index;
    if (lostEvents[index]["type"]?.GetValue<string>() == "RUN_FINISHED") lostFinished = index;
}
Check(lostSource.Input!["tools"]!.AsArray().Count == 0 && lostResult >= 0 && lostFinished > lostResult && lostEvents[lostResult]["content"]?.GetValue<string>() == "MCP tool discovery failed: show_weather", "exclude-only page failure reports a discovery error and hides the partial catalog");
var aliasWire = new SplitPageFailHandler(); using var aliasHttp = new HttpClient(aliasWire);
var aliasSource = new SequenceAgent([
    JsonNode.Parse("{\"type\":\"RUN_STARTED\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"TOOL_CALL_START\",\"toolCallId\":\"alias\",\"toolCallName\":\"beta__search\"}")!.AsObject(),
    JsonNode.Parse("{\"type\":\"RUN_FINISHED\"}")!.AsObject()
]);
var aliasAlpha = new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "alpha", Headers = new Dictionary<string, string> { ["x-token"] = "alpha" } };
var aliasBeta = new McpAppServer { Url = new Uri("https://mcp.test/mcp"), ServerId = "beta", Headers = new Dictionary<string, string> { ["x-token"] = "beta" } };
var aliasEvents = new List<JsonObject>(); await foreach (var item in new McpAppsAgent(aliasSource, [aliasAlpha, aliasBeta], aliasHttp).RunAsync(input, CancellationToken.None)) aliasEvents.Add(item);
var aliasNames = aliasSource.Input!["tools"]!.AsArray().Select(tool => tool?["name"]?.GetValue<string>()).ToArray();
var aliasResult = -1; var aliasFinished = -1;
for (var index = 0; index < aliasEvents.Count; index++)
{
    if (aliasEvents[index]["toolCallId"]?.GetValue<string>() == "alias" && aliasEvents[index]["type"]?.GetValue<string>() == "TOOL_CALL_RESULT") aliasResult = index;
    if (aliasEvents[index]["type"]?.GetValue<string>() == "RUN_FINISHED") aliasFinished = index;
}
Check(aliasNames.SequenceEqual(new string?[] { "search" }) && aliasResult >= 0 && aliasFinished > aliasResult && aliasEvents[aliasResult]["content"]?.GetValue<string>() == "MCP tool discovery failed: beta__search", "a renamed tool discarded by discovery failure is not left pending");
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
    public List<string> ToolCalls { get; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        Methods.Add(method);
        if (method == "tools/call" && A2UIValidation.Text(body["params"]?["name"]) is { } toolName) ToolCalls.Add(toolName);
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
sealed class WideMcpHandler(int count, bool includeWanted, bool more) : HttpMessageHandler
{
    public int Lists { get; private set; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        if (body["id"] is null) return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted);
        JsonNode? result;
        if (method == "tools/list")
        {
            Lists++;
            var tools = new JsonArray();
            for (var index = 0; index < count; index++)
            {
                var name = includeWanted && index == count - 1 ? "wanted" : "tool-" + index;
                tools.Add(new JsonObject { ["name"] = name, ["inputSchema"] = new JsonObject { ["type"] = "object" }, ["_meta"] = new JsonObject { ["ui"] = new JsonObject { ["resourceUri"] = "ui://t/" + index } } });
            }
            var page = new JsonObject { ["tools"] = tools };
            if (more) page["nextCursor"] = "page-2";
            result = page;
        }
        else result = JsonNode.Parse("{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}");
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result }) };
        if (method == "initialize") response.Headers.Add("Mcp-Session-Id", "session-wide");
        return response;
    }
}
sealed class SharedNameHandler : HttpMessageHandler
{
    public List<(string Token, string Tool)> ToolCalls { get; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var token = request.Headers.TryGetValues("x-token", out var tokens) ? tokens.Single() : "";
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        if (body["id"] is null) return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted);
        JsonNode? result;
        if (method == "tools/list") result = JsonNode.Parse("{\"tools\":[{\"name\":\"show_weather\",\"description\":\"Weather\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui\":{\"resourceUri\":\"ui://weather\"}}}]}");
        else if (method == "tools/call")
        {
            var name = A2UIValidation.Text(body["params"]?["name"]) ?? "";
            ToolCalls.Add((token, name));
            result = JsonNode.Parse("{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}");
        }
        else result = JsonNode.Parse("{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}");
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result }) };
        if (method == "initialize") response.Headers.Add("Mcp-Session-Id", "session-" + token);
        return response;
    }
}
sealed class FlakyListHandler : HttpMessageHandler
{
    public int Lists { get; private set; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        if (body["id"] is null) return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted);
        if (method == "tools/list")
        {
            Lists++;
            if (Lists < 2) return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
        }
        var result = method == "tools/list"
            ? JsonNode.Parse("{\"tools\":[{\"name\":\"generate_qr\",\"description\":\"QR\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui\":{\"resourceUri\":\"ui://qr\"}}}]}")
            : JsonNode.Parse("{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}");
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result }) };
        if (method == "initialize") response.Headers.Add("Mcp-Session-Id", "session-flaky");
        return response;
    }
}
sealed class NonUiFilterHandler : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        if (body["id"] is null) return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted);
        var result = method == "tools/list"
            ? JsonNode.Parse("{\"tools\":[{\"name\":\"generate_qr\",\"description\":\"QR\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui\":{\"resourceUri\":\"ui://qr\"}}},{\"name\":\"admin_dashboard\",\"description\":\"Admin\",\"inputSchema\":{\"type\":\"object\"}}]}")
            : JsonNode.Parse("{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}");
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result }) };
        if (method == "initialize") response.Headers.Add("Mcp-Session-Id", "session-nonui");
        return response;
    }
}
sealed class SplitPageFailHandler : HttpMessageHandler
{
    public int BetaLists { get; private set; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var token = request.Headers.TryGetValues("x-token", out var tokens) ? tokens.Single() : "";
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        if (body["id"] is null) return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted);
        if (method == "tools/list" && token == "beta")
        {
            BetaLists++;
            if (BetaLists > 1) return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            var page = JsonNode.Parse("{\"tools\":[{\"name\":\"search\",\"description\":\"Search\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui\":{\"resourceUri\":\"ui://search\"}}}],\"nextCursor\":\"page-2\"}");
            var partial = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = page }) };
            partial.Headers.Add("Mcp-Session-Id", "session-beta");
            return partial;
        }
        var result = method == "tools/list"
            ? JsonNode.Parse("{\"tools\":[{\"name\":\"search\",\"description\":\"Search\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui\":{\"resourceUri\":\"ui://search\"}}}]}")
            : JsonNode.Parse("{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}");
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result }) };
        if (method == "initialize") response.Headers.Add("Mcp-Session-Id", "session-" + token);
        return response;
    }
}
sealed class PagedFailHandler : HttpMessageHandler
{
    public int Lists { get; private set; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Delete) return new HttpResponseMessage(System.Net.HttpStatusCode.NoContent);
        var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        var method = body["method"]!.GetValue<string>();
        if (body["id"] is null) return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted);
        if (method == "tools/list")
        {
            Lists++;
            if (Lists > 1) return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            var page = JsonNode.Parse("{\"tools\":[{\"name\":\"show_weather\",\"description\":\"Weather\",\"inputSchema\":{\"type\":\"object\"},\"_meta\":{\"ui\":{\"resourceUri\":\"ui://weather\"}}}],\"nextCursor\":\"page-2\"}");
            var ok = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = page }) };
            ok.Headers.Add("Mcp-Session-Id", "session-paged");
            return ok;
        }
        var result = JsonNode.Parse("{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}");
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = body["id"]!.DeepClone(), ["result"] = result }) };
        if (method == "initialize") response.Headers.Add("Mcp-Session-Id", "session-paged");
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
