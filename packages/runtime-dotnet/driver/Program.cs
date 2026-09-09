using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

var config = JsonNode.Parse(Environment.GetEnvironmentVariable("CPK_CONFIG") ?? throw new InvalidOperationException("CPK_CONFIG is required"))!;
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:" + (config["port"]?.GetValue<int>() ?? 0));
var app = builder.Build();
using var agentHttp = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
using var telemetryHttp = new HttpClient();
await using var runtime = new IntelligenceRuntime(new RuntimeOptions
{
    ApiUrl = new Uri(config["apiUrl"]!.GetValue<string>()), RunnerUrl = new Uri(config["runnerUrl"]!.GetValue<string>()), ClientUrl = new Uri(config["clientUrl"]!.GetValue<string>()), ApiKey = config["apiKey"]!.GetValue<string>(),
    Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new HttpAgent(new Uri(config["agentUrl"]!.GetValue<string>()), agentHttp, "Conformance agent") },
    IdentifyUser = (context, _) => ValueTask.FromResult<RuntimeUser?>(new RuntimeUser(context.Request.Headers["x-test-user-id"].FirstOrDefault() ?? "test-user", context.Request.Headers["x-test-user-name"].FirstOrDefault() ?? "Test User")),
    TelemetryDisabled = config["telemetryDisabled"]?.GetValue<bool>() ?? false,
    TelemetryExporter = config["telemetryUrl"] is null ? null : new HttpTelemetryExporter(telemetryHttp, new Uri(config["telemetryUrl"]!.GetValue<string>())),
    AckTimeout = TimeSpan.FromMilliseconds(config["ackTimeoutMs"]?.GetValue<int>() ?? 500),
    LockHeartbeatInterval = TimeSpan.FromMilliseconds(config["lockHeartbeatMs"]?.GetValue<int>() ?? 1000)
});
runtime.Map(app);
await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
Console.WriteLine(new JsonObject { ["port"] = new Uri(address).Port }.ToJsonString());
await app.WaitForShutdownAsync();
