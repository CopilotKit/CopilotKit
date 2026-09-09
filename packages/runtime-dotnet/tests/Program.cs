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
var testBuilder = WebApplication.CreateBuilder(); testBuilder.Logging.ClearProviders(); testBuilder.WebHost.UseUrls("http://127.0.0.1:0");
await using var testApp = testBuilder.Build();
var export = new CaptureExporter(); var transport = new CountingHandler(); using var platformClient = new HttpClient(transport);
await using var secured = new IntelligenceRuntime(new RuntimeOptions
{
    ApiUrl = new Uri("http://invalid.local"), RunnerUrl = new Uri("ws://invalid.local/runner"), ClientUrl = new Uri("ws://invalid.local/client"), ApiKey = "test",
    Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new CaptureAgent() },
    IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser("trusted")),
    MemoryGrant = (_, _, _) => ValueTask.FromResult<JsonObject?>(null), TelemetryExporter = export
}, platformClient);
secured.Map(testApp); await testApp.StartAsync();
using var browser = new HttpClient { BaseAddress = new Uri(testApp.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
var deniedMemory = await browser.PostAsJsonAsync("/copilotkit/memories", new { content = "private", kind = "topical" });
Check((int)deniedMemory.StatusCode == 403 && transport.Calls == 0, "null configured memory grant denies before platform");
await browser.PostAsJsonAsync("/copilotkit/agent/default/SECRET", new { });
await testApp.StopAsync(); await secured.DisposeAsync();
Check(!System.Text.Json.JsonSerializer.Serialize(export.Events).Contains("SECRET", StringComparison.Ordinal), "unrecognized route segments never enter telemetry");

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
        Calls++; return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = JsonContent.Create(new { memory = new { id = "m" } }) });
    }
}
