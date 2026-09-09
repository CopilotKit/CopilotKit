using CopilotKit.Intelligence;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

internal static class TelemetryTests
{
    internal static async Task RunAsync()
    {
        static void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); }
        var exporter = new CaptureExporter();
        await using (var telemetry = new RuntimeTelemetry(Options(exporter, 1)))
        {
            telemetry.Record("oss.runtime.copilot_request_created", "agent.run");
            telemetry.Record("oss.runtime.agent_execution_stream_started", "agent.run");
            telemetry.Record("oss.runtime.agent_execution_stream_ended", "agent.run", durationMs: 234);
            telemetry.Record("gateway.event_retry", "agent.run", attempt: 2);
        }
        Check(exporter.Events.Count == 4, "analytics exports only the TypeScript event vocabulary");
        var instance = exporter.Events.Single(value => value.Event == "oss.runtime.instance_created");
        Check(instance.Attributes.Count == 5 && (int)instance.Attributes["agentsAmount"]! == 1 && (int)instance.Attributes["actionsAmount"]! == 0, "instance telemetry uses exact flattened properties");
        var ended = exporter.Events.Single(value => value.Event.EndsWith("_ended", StringComparison.Ordinal));
        Check(ended.Attributes.Count == 0, "ended analytics has no local timing or operation fields");
        Check((double)ended.GlobalProperties["sampleRate"]! == 1 && (double)ended.GlobalProperties["sampleWeight"]! == 1, "analytics includes sampling metadata");
        var zero = new CaptureExporter(); await using (var telemetry = new RuntimeTelemetry(Options(zero, 0, "identity-does-not-bypass"))) telemetry.Record("oss.runtime.agent_execution_stream_started", "agent.run");
        Check(zero.Events.Count == 0, "standalone telemetry identity does not bypass zero sampling");
        var idOptions = Options(new CaptureExporter(), 1, " \t valid_id-1\t ");
        Check(TelemetrySettings.Resolve(idOptions).Identity == "valid_id-1", "telemetry identity trims spaces and tabs");
        Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 1, "bad\nid")).Identity is null, "telemetry rejects identity header injection");
        var vars = new[] { "COPILOTKIT_TELEMETRY_SAMPLE_RATE", "COPILOTKIT_TELEMETRY_DISABLED", "DO_NOT_TRACK", "CPK_TELEMETRY_ID" };
        var prior = vars.ToDictionary(name => name, Environment.GetEnvironmentVariable);
        try
        {
            Environment.SetEnvironmentVariable("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "0");
            Environment.SetEnvironmentVariable("CPK_TELEMETRY_ID", "environment-id");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 1, "bad\nid")).SampleRate == 0, "sample environment overrides config");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 1, "bad\nid")).Identity == "environment-id", "invalid configured identity falls through to valid environment identity");
            Environment.SetEnvironmentVariable("DO_NOT_TRACK", "1");
            Check(TelemetrySettings.Resolve(Options(new CaptureExporter(), 1)).Disabled, "DO_NOT_TRACK wins over enabled configuration");
            Environment.SetEnvironmentVariable("DO_NOT_TRACK", "false");
            Environment.SetEnvironmentVariable("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "NaN");
            try { TelemetrySettings.Resolve(Options(new CaptureExporter(), 1)); throw new Exception("NaN accepted"); } catch (ArgumentOutOfRangeException) { Check(true, "invalid sample rate rejected"); }
        }
        finally { foreach (var pair in prior) Environment.SetEnvironmentVariable(pair.Key, pair.Value); }
        var stalled = new StalledExporter(); var clock = Stopwatch.StartNew();
        await using (var telemetry = new RuntimeTelemetry(Options(stalled, 1)))
            for (var i = 0; i < 1000; i++) telemetry.Record("oss.runtime.agent_execution_stream_started", "agent.run");
        Check(clock.Elapsed < TimeSpan.FromSeconds(5), "saturated unresponsive exporter cannot block shutdown");
        var builder = WebApplication.CreateBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build(); JsonNode? payload = null; string? idHeader = null; var redirected = 0;
        app.MapPost("/capture", async (HttpContext context) => { payload = await JsonNode.ParseAsync(context.Request.Body); idHeader = context.Request.Headers["X-CopilotKit-Telemetry-Id"].ToString(); context.Response.StatusCode = 204; });
        app.MapPost("/redirect", (HttpContext context) => { context.Response.StatusCode = 307; context.Response.Headers.Location = "/redirected"; });
        app.MapPost("/redirected", () => { redirected++; return Results.NoContent(); });
        await app.StartAsync();
        var endpoint = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        await using (var sender = new HttpTelemetryExporter(new Uri(endpoint + "/capture"))) await sender.ExportAsync(instance with { Identity = "header_only_identity" }, CancellationToken.None);
        Check(payload?["ts"]?.GetValue<long>() is { } timestamp && Math.Abs(timestamp - DateTimeOffset.UtcNow.ToUnixTimeSeconds()) < 10, "HTTP telemetry timestamp uses integer Unix seconds");
        Check(idHeader == "header_only_identity" && !payload!.ToJsonString().Contains("header_only_identity", StringComparison.Ordinal), "HTTP telemetry identity travels only in header");
        await using (var sender = new HttpTelemetryExporter(new Uri(endpoint + "/redirect")))
        {
            try { await sender.ExportAsync(instance, CancellationToken.None); } catch (HttpRequestException) { }
        }
        Check(redirected == 0, "HTTP analytics never follows redirects");
        await app.StopAsync();
        await LicenseTelemetryTests.RunAsync();
    }
    private static RuntimeOptions Options(IRuntimeTelemetryExporter exporter, double sampleRate, string? identity = null) => new()
    {
        ApiUrl = new Uri("http://unused.invalid"), RunnerUrl = new Uri("ws://unused.invalid/runner"), ClientUrl = new Uri("ws://unused.invalid/client"), ApiKey = "never-export",
        Agents = new Dictionary<string, IRuntimeAgent> { ["default"] = new SequenceAgent([]) }, IdentifyUser = (_, _) => ValueTask.FromResult<RuntimeUser?>(null),
        TelemetryExporter = exporter, TelemetrySampleRate = sampleRate, TelemetryId = identity
    };
    private sealed class StalledExporter : IRuntimeTelemetryExporter
    {
        public ValueTask ExportAsync(RuntimeTelemetryEvent value, CancellationToken cancellationToken) => new(Task.Delay(Timeout.Infinite, cancellationToken));
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
