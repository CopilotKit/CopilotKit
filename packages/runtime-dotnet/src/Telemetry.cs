using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Threading.Channels;
using System.Net.Http.Json;

namespace CopilotKit.Intelligence;

/// <summary>Allowlisted operational telemetry. Never includes prompts, user IDs, tokens, URLs, or exception messages.</summary>
public sealed record RuntimeTelemetryEvent(string Event, DateTimeOffset Timestamp, IReadOnlyDictionary<string, object?> Attributes);

public interface IRuntimeTelemetryExporter : IAsyncDisposable
{
    ValueTask ExportAsync(RuntimeTelemetryEvent value, CancellationToken cancellationToken);
}

/// <summary>Exports safe event envelopes to a server-chosen endpoint.</summary>
public sealed class HttpTelemetryExporter(HttpClient client, Uri endpoint) : IRuntimeTelemetryExporter
{
    public async ValueTask ExportAsync(RuntimeTelemetryEvent value, CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync(endpoint, new
        {
            @event = value.Event,
            ts = value.Timestamp.ToUnixTimeMilliseconds(),
            package = new { name = "CopilotKit.Intelligence.Runtime", version = "0.1.0" },
            global_properties = new { language = "dotnet", runtime = Environment.Version.ToString() },
            properties = value.Attributes
        }, cancellationToken);
        response.EnsureSuccessStatusCode();
    }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

internal sealed class RuntimeTelemetry : IAsyncDisposable
{
    public static readonly ActivitySource ActivitySource = new("CopilotKit.Intelligence.Runtime", "0.1.0");
    private readonly Meter meter = new("CopilotKit.Intelligence.Runtime", "0.1.0");
    private readonly Counter<long> events;
    private readonly Histogram<double> durations;
    private readonly Channel<RuntimeTelemetryEvent> queue = Channel.CreateBounded<RuntimeTelemetryEvent>(new BoundedChannelOptions(256) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });
    private readonly RuntimeOptions options;
    private readonly Task pump;
    internal RuntimeTelemetry(RuntimeOptions options)
    {
        this.options = options; events = meter.CreateCounter<long>("copilotkit.runtime.events"); durations = meter.CreateHistogram<double>("copilotkit.runtime.duration", "ms");
        pump = PumpAsync();
        Record("oss.runtime.instance_created", "runtime");
    }
    internal void Record(string name, string operation, int? status = null, double? durationMs = null, int? attempt = null)
    {
        if (options.TelemetryDisabled) return;
        var attrs = new Dictionary<string, object?> { ["operation"] = operation, ["language"] = "dotnet" };
        if (status.HasValue) attrs["status"] = status.Value;
        if (durationMs.HasValue) attrs["durationMs"] = durationMs.Value;
        if (attempt.HasValue) attrs["attempt"] = attempt.Value;
        events.Add(1, new KeyValuePair<string, object?>("event", name));
        if (durationMs.HasValue) durations.Record(durationMs.Value, new KeyValuePair<string, object?>("operation", operation));
        queue.Writer.TryWrite(new RuntimeTelemetryEvent(name, DateTimeOffset.UtcNow, attrs));
    }
    private async Task PumpAsync()
    {
        await foreach (var item in queue.Reader.ReadAllAsync())
        {
            if (options.TelemetryExporter is null) continue;
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try { await options.TelemetryExporter.ExportAsync(item, timeout.Token); } catch (Exception) { /* Export failure must not fail a customer request. */ }
        }
    }
    public async ValueTask DisposeAsync()
    {
        queue.Writer.TryComplete(); await pump; meter.Dispose();
        if (options.TelemetryExporter is not null) await options.TelemetryExporter.DisposeAsync();
    }
}
