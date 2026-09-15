using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Globalization;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;

namespace CopilotKit.Intelligence;

/// <summary>Allowlisted analytics. Identity travels only in the HTTP header, never in the event body.</summary>
public sealed record RuntimeTelemetryEvent(string Event, DateTimeOffset Timestamp, IReadOnlyDictionary<string, object?> Attributes)
{
    public IReadOnlyDictionary<string, object?> GlobalProperties { get; init; } = new ReadOnlyDictionary<string, object?>(new Dictionary<string, object?>());
    internal string? Identity { get; init; }
}

/// <summary>Receives sampled analytics. Exporters must honor cancellation.</summary>
public interface IRuntimeTelemetryExporter : IAsyncDisposable
{
    ValueTask ExportAsync(RuntimeTelemetryEvent value, CancellationToken cancellationToken);
}

/// <summary>Posts analytics without redirects, shared credentials, or cookies.</summary>
public sealed class HttpTelemetryExporter : IRuntimeTelemetryExporter
{
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
    private readonly Uri endpoint;
    public HttpTelemetryExporter(Uri endpoint)
    {
        if (!endpoint.IsAbsoluteUri || endpoint.Scheme is not ("http" or "https") || endpoint.UserInfo.Length > 0) throw new ArgumentException("Telemetry endpoint must be HTTP(S), without embedded credentials.");
        this.endpoint = endpoint;
    }
    public async ValueTask ExportAsync(RuntimeTelemetryEvent value, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = JsonContent.Create(new
            {
                @event = value.Event, ts = value.Timestamp.ToUnixTimeSeconds(),
                package = new { name = "CopilotKit.Intelligence.Runtime", version = "0.1.0" },
                global_properties = value.GlobalProperties, properties = value.Attributes
            })
        };
        request.Headers.UserAgent.ParseAdd("CopilotKit-Runtime/0.1.0 (CopilotKit.Intelligence.Runtime)");
        if (value.Identity is not null) request.Headers.Add("X-CopilotKit-Telemetry-Id", value.Identity);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        response.EnsureSuccessStatusCode();
    }
    public ValueTask DisposeAsync() { client.Dispose(); return ValueTask.CompletedTask; }
}

internal sealed record TelemetrySettings(bool Disabled, double SampleRate, string? Identity, Uri Endpoint, bool Identified = false)
{
    internal static TelemetrySettings Resolve(RuntimeOptions options)
    {
        var disabled = options.TelemetryDisabled || True(Environment.GetEnvironmentVariable("DO_NOT_TRACK")) || True(Environment.GetEnvironmentVariable("COPILOTKIT_TELEMETRY_DISABLED"));
        var rate = options.TelemetrySampleRate;
        var configuredRate = Environment.GetEnvironmentVariable("COPILOTKIT_TELEMETRY_SAMPLE_RATE");
        if (!string.IsNullOrWhiteSpace(configuredRate) && !double.TryParse(configuredRate, NumberStyles.Float, CultureInfo.InvariantCulture, out rate)) throw new ArgumentOutOfRangeException(nameof(options.TelemetrySampleRate), "Telemetry sample rate must be finite and between zero and one.");
        if (!double.IsFinite(rate) || rate < 0 || rate > 1) throw new ArgumentOutOfRangeException(nameof(options.TelemetrySampleRate), "Telemetry sample rate must be finite and between zero and one.");
        string? identity = null;
        foreach (var candidate in new[] { options.TelemetryId, Environment.GetEnvironmentVariable("CPK_TELEMETRY_ID") })
        {
            var normalized = candidate?.Trim(' ', '\t');
            if (normalized is not null && Regex.IsMatch(normalized, "\\A[A-Za-z0-9_-]{1,128}\\z", RegexOptions.CultureInvariant)) { identity = normalized; break; }
        }
        var identified = false;
        if (identity is null)
        {
            // Match JavaScript trim for license placeholders, without changing the selected token.
            var token = new[] { options.LicenseToken, Environment.GetEnvironmentVariable("COPILOTKIT_LICENSE_TOKEN") }.FirstOrDefault(candidate => candidate is not null && Regex.IsMatch(candidate, "[^\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]", RegexOptions.CultureInvariant));
            identity = ParseLicenseIdentity(token);
            identified = identity is not null;
            if (identified) rate = 1;
        }
        var endpoint = Environment.GetEnvironmentVariable("COPILOTKIT_TELEMETRY_URL");
        var url = string.IsNullOrWhiteSpace(endpoint) ? options.TelemetryUrl ?? new Uri("https://telemetry.copilotkit.ai/ingest") : new Uri(endpoint);
        if (!url.IsAbsoluteUri || url.Scheme is not ("http" or "https") || url.UserInfo.Length > 0) throw new ArgumentException("Telemetry endpoint must be HTTP(S), without embedded credentials.");
        return new TelemetrySettings(disabled, rate, identity, url, identified);
    }

    /// <summary>Reads the legacy analytics claim without verifying JWT signatures or authorizing access.</summary>
    private static string? ParseLicenseIdentity(string? token)
    {
        if (string.IsNullOrEmpty(token)) return null;
        var parts = token.Split('.');
        if (parts.Length != 3) return null;
        var payload = parts[1];
        if (!Regex.IsMatch(payload, "\\A[A-Za-z0-9_-]+\\z", RegexOptions.CultureInvariant) || payload.Length % 4 == 1) return null;
        try
        {
            var base64 = payload.Replace('-', '+').Replace('_', '/');
            base64 += new string('=', (4 - base64.Length % 4) % 4);
            using var document = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(base64)));
            if (document.RootElement.ValueKind != JsonValueKind.Object || !document.RootElement.TryGetProperty("telemetry_id", out var claim) || claim.ValueKind != JsonValueKind.String) return null;
            var normalized = claim.GetString()!.Trim(' ', '\t');
            return Regex.IsMatch(normalized, "\\A[A-Za-z0-9_-]{1,128}\\z", RegexOptions.CultureInvariant) ? normalized : null;
        }
        catch (Exception error) when (error is JsonException or FormatException or InvalidOperationException) { return null; }
    }
    private static bool True(string? value) => value is "true" or "1";
}

internal sealed class RuntimeTelemetry : IAsyncDisposable
{
    public static readonly ActivitySource ActivitySource = new("CopilotKit.Intelligence.Runtime", "0.1.0");
    private readonly Meter meter = new("CopilotKit.Intelligence.Runtime", "0.1.0");
    private readonly Counter<long> events;
    private readonly Histogram<double> durations;
    private readonly Counter<long> dropped;
    private readonly Channel<RuntimeTelemetryEvent> queue = Channel.CreateBounded<RuntimeTelemetryEvent>(new BoundedChannelOptions(256) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true });
    private readonly RuntimeOptions options;
    private readonly TelemetrySettings settings;
    private readonly IRuntimeTelemetryExporter? exporter;
    private readonly CancellationTokenSource shutdown = new();
    private readonly Task pump;
    private int disposed;
    internal bool Disabled => settings.Disabled;

    internal RuntimeTelemetry(RuntimeOptions options)
    {
        this.options = options; settings = TelemetrySettings.Resolve(options);
        events = meter.CreateCounter<long>("copilotkit.runtime.events"); durations = meter.CreateHistogram<double>("copilotkit.runtime.duration", "ms"); dropped = meter.CreateCounter<long>("copilotkit.runtime.telemetry_dropped");
        exporter = options.TelemetryExporter ?? (!settings.Disabled && settings.SampleRate > 0 ? new HttpTelemetryExporter(settings.Endpoint) : null);
        pump = PumpAsync(); Record("oss.runtime.instance_created", "runtime");
    }
    internal void Record(string name, string operation, int? status = null, double? durationMs = null, int? attempt = null, string? errorCode = null)
    {
        if (settings.Disabled || Volatile.Read(ref disposed) != 0) return;
        events.Add(1, new KeyValuePair<string, object?>("event", name));
        if (durationMs.HasValue) durations.Record(durationMs.Value, new KeyValuePair<string, object?>("operation", operation));
        // Operational metrics stay local; analytics exports only TypeScript-compatible events.
        Dictionary<string, object?> attributes;
        switch (name)
        {
            case "oss.runtime.instance_created": attributes = new() { ["actionsAmount"] = 0, ["endpointTypes"] = Array.Empty<string>(), ["endpointsAmount"] = 0, ["agentsAmount"] = options.Agents.Count, ["cloud.api_key_provided"] = false }; break;
            case "oss.runtime.copilot_request_created" when operation is "agent.run" or "agent.connect": attributes = new() { ["requestType"] = operation == "agent.run" ? "run" : "connect", ["cloud.guardrails.enabled"] = false, ["cloud.api_key_provided"] = false }; break;
            case "oss.runtime.agent_execution_stream_started":
            case "oss.runtime.agent_execution_stream_ended": attributes = new(); break;
            case "oss.runtime.agent_execution_stream_errored": attributes = new() { ["error"] = errorCode is "RUN_CANCELLED" or "AGENT_EXECUTION_FAILED" or "RUN_STARTUP_FAILED" ? errorCode : "AGENT_EXECUTION_FAILED" }; break;
            default: return;
        }
        if (settings.SampleRate == 0 || Random.Shared.NextDouble() >= settings.SampleRate) return;
        var globals = new ReadOnlyDictionary<string, object?>(new Dictionary<string, object?>
        {
            ["sampleRate"] = settings.SampleRate, ["sampleRateAdjustmentFactor"] = 1 - settings.SampleRate, ["sampleWeight"] = 1 / settings.SampleRate,
            ["telemetry_identified"] = settings.Identified, ["telemetry_emitter"] = "native", ["telemetry_transport"] = "lambda"
        });
        var value = new RuntimeTelemetryEvent(name, DateTimeOffset.UtcNow, new ReadOnlyDictionary<string, object?>(attributes)) { GlobalProperties = globals, Identity = settings.Identity };
        if (!queue.Writer.TryWrite(value)) dropped.Add(1);
    }
    private async Task PumpAsync()
    {
        try
        {
            await foreach (var item in queue.Reader.ReadAllAsync(shutdown.Token))
            {
                if (exporter is null) continue;
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token); timeout.CancelAfter(TimeSpan.FromSeconds(3));
                try { await exporter.ExportAsync(item, timeout.Token).AsTask().WaitAsync(timeout.Token); }
                catch (Exception) { /* Analytics failures never enter customer error reporting or runtime control flow. */ }
            }
        }
        catch (OperationCanceledException) when (shutdown.IsCancellationRequested) { }
    }
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        queue.Writer.TryComplete(); shutdown.CancelAfter(TimeSpan.FromSeconds(3));
        try { await pump.WaitAsync(shutdown.Token); } catch (OperationCanceledException) { }
        await shutdown.CancelAsync();
        if (exporter is not null)
        {
            try { await exporter.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromMilliseconds(500)); } catch (Exception) { }
        }
        meter.Dispose();
        // A custom exporter can ignore cancellation. Keep its token source valid if its pump still owns it.
        if (pump.IsCompleted) shutdown.Dispose();
    }
}
