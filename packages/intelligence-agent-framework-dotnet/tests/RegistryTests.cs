using System.Net;
using System.Text.Json;
using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;

internal static class RegistryTests
{
    internal static async Task RunAsync()
    {
        using var snapshots = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "snapshots.v1.json")));
        using var lifecycle = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "lifecycle.v1.json")));
        foreach (var fixture in lifecycle.RootElement.GetProperty("cases").EnumerateArray())
        {
            var clock = new Clock();
            var requests = 0;
            JsonElement reply = default;
            string? pin = fixture.TryGetProperty("config", out var config) ? config.GetProperty("revision").GetString() : null;
            using var http = new HttpClient(new Handler((request, token) => {
                requests++;
                if (pin is not null && !request.RequestUri!.Query.Contains("revision=" + pin)) throw new Exception("pin omitted");
                if (reply.TryGetProperty("error", out var error))
                    throw new LearnedSkillsException(error.GetString()!, reply.GetProperty("retryable").GetBoolean());
                var unchanged = reply.TryGetProperty("unchanged", out var name);
                if (!unchanged) name = reply.GetProperty("snapshot");
                var source = snapshots.RootElement.GetProperty("cases").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name.GetString());
                var response = new HttpResponseMessage(unchanged ? HttpStatusCode.NotModified : HttpStatusCode.OK);
                response.Headers.TryAddWithoutValidation("ETag", source.GetProperty("etag").GetString());
                response.Headers.TryAddWithoutValidation("X-CopilotKit-Skills-Revision", source.GetProperty("revision").GetString());
                if (unchanged && !request.Headers.Contains("If-None-Match")) throw new Exception("conditional request missing");
                response.Content = new ByteArrayContent(Convert.FromBase64String(source.GetProperty("archiveBase64").GetString()!));
                response.Content.Headers.ContentType = new("application/zip");
                return Task.FromResult(response);
            }));
            using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
            using var registry = new SkillRegistry(new SkillRegistryOptions { Client = client, ContainerId = "container", Revision = pin }, clock);
            foreach (var step in fixture.GetProperty("steps").EnumerateArray())
            {
                if (step.TryGetProperty("advanceMs", out var advance)) clock.Now += TimeSpan.FromMilliseconds(advance.GetInt64());
                if (step.TryGetProperty("reply", out var next)) reply = next;
                var expected = step.GetProperty("expect");
                try
                {
                    var snapshot = await registry.AcquireAsync();
                    if (expected.TryGetProperty("error", out _)) throw new Exception("expected failure");
                    Equal(snapshot.Revision, expected.GetProperty("revision").GetString());
                }
                catch (LearnedSkillsException error)
                {
                    if (!expected.TryGetProperty("error", out var wanted)) throw;
                    Equal(error.Code, wanted.GetString());
                }
                Equal(requests, expected.GetProperty("requests").GetInt32());
                if (expected.TryGetProperty("stale", out var stale)) Equal(registry.Status.Stale, stale.GetBoolean());
                if (expected.TryGetProperty("initialized", out var initialized)) Equal(registry.Status.Initialized, initialized.GetBoolean());
                if (expected.TryGetProperty("lastCheckedAt", out var lastChecked)) Equal(registry.Status.LastCheckedAt, DateTimeOffset.Parse(lastChecked.GetString()!));
            }
            Console.WriteLine("PASS lifecycle " + fixture.GetProperty("name").GetString());
        }
    }
    internal static async Task ConcurrencyAsync()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var requests = 0;
        using var http = new HttpClient(new Handler(async (_, token) => {
            Interlocked.Increment(ref requests);
            entered.TrySetResult();
            await release.Task.WaitAsync(token);
            return Empty();
        }));
        using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
        using var registry = new SkillRegistry(new SkillRegistryOptions { Client = client, ContainerId = "container" });
        using var cancelled = new CancellationTokenSource();
        var first = registry.AcquireAsync(cancelled.Token);
        await entered.Task;
        var second = registry.AcquireAsync();
        cancelled.Cancel();
        await ThrowsAsync<OperationCanceledException>(async () => await first);
        Equal(requests, 1);
        release.SetResult();
        var pinned = await second;
        Equal(ReferenceEquals(pinned, await registry.AcquireAsync()), true);
        Equal(requests, 1);
        registry.Dispose();
        await client.GetLearnedSkillsSnapshotAsync("container");
        Equal(requests, 2);
        Console.WriteLine("PASS shared refresh, cancelled waiter, and injected ownership");
    }

    internal static async Task DeadlineAsync()
    {
        foreach (var denied in new[] { false, true })
        {
            using var http = new HttpClient(new Handler(async (_, token) => {
                if (denied) return new HttpResponseMessage(HttpStatusCode.Forbidden) { Content = new SlowContent() };
                await Task.Delay(Timeout.Infinite, token);
                return Empty();
            }));
            using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
            using var registry = new SkillRegistry(new SkillRegistryOptions {
                Client = client, ContainerId = "container", RequestTimeout = TimeSpan.FromMilliseconds(30)
            });
            try { await registry.AcquireAsync().WaitAsync(TimeSpan.FromSeconds(3)); throw new Exception("expected failure"); }
            catch (LearnedSkillsException error) { Equal(error.Code, denied ? "AUTHORIZATION_FAILED" : "TIMEOUT"); }
        }
        using var closingHttp = new HttpClient(new Handler(async (_, token) => {
            await Task.Delay(Timeout.Infinite, token);
            return Empty();
        }));
        using var closingClient = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, closingHttp);
        using var closing = new SkillRegistry(new SkillRegistryOptions { Client = closingClient, ContainerId = "container" });
        var active = closing.AcquireAsync();
        closing.Dispose();
        closing.Dispose();
        await ThrowsAsync<OperationCanceledException>(async () => await active.WaitAsync(TimeSpan.FromSeconds(3)));
        Console.WriteLine("PASS deadlines, known denial, and active disposal");
    }

    internal static async Task ConfigurationAsync()
    {
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(Empty())));
        using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
        var original = Console.Error;
        try
        {
            using var writer = new StringWriter();
            Console.SetError(writer);
            using (var quiet = new SkillRegistry(new SkillRegistryOptions { Client = client, ContainerId = "container" }))
                await quiet.AcquireAsync();
            Equal(writer.ToString(), "");
            using (var debug = new SkillRegistry(new SkillRegistryOptions { Client = client, ContainerId = "container", Debug = true }))
                await debug.AcquireAsync();
            Equal(writer.ToString().Trim(), "Learned skills loaded.");
            Console.SetError(new ThrowingWriter());
            using var isolated = new SkillRegistry(new SkillRegistryOptions { Client = client, ContainerId = "container", Debug = true });
            await isolated.AcquireAsync();
            Equal(isolated.Status.Stale, false);
            Equal(isolated.Status.LastError, null);
        }
        finally { Console.SetError(original); }
        foreach (var options in new[] {
            new SkillRegistryOptions { Client = client, ContainerId = " " },
            new SkillRegistryOptions { Client = client, ContainerId = ".." },
            new SkillRegistryOptions { Client = client, ContainerId = "container", Revision = "" },
            new SkillRegistryOptions { Client = client, ContainerId = "container", FreshnessWindow = TimeSpan.FromMilliseconds(-1) },
            new SkillRegistryOptions { Client = client, ContainerId = "container", RequestTimeout = TimeSpan.Zero },
            new SkillRegistryOptions { ApiKey = "", ContainerId = "container" }
        })
        {
            try { using var invalid = new SkillRegistry(options); throw new Exception("accepted invalid configuration"); }
            catch (LearnedSkillsException error) { Equal(error.Code, "INVALID_CONFIG"); }
        }
        var endpoint = Environment.GetEnvironmentVariable("INTELLIGENCE_API_URL");
        var key = Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_API_KEY");
        try
        {
            Environment.SetEnvironmentVariable("INTELLIGENCE_API_URL", "invalid endpoint");
            Environment.SetEnvironmentVariable("CPK_INTELLIGENCE_API_KEY", "");
            using var injected = new SkillRegistry(new SkillRegistryOptions {
                Client = client, ApiKey = "", ApiUrl = new Uri("relative", UriKind.Relative), ContainerId = "container"
            });
            await injected.AcquireAsync();
            injected.Dispose();
            await ThrowsAsync<ObjectDisposedException>(async () => await injected.AcquireAsync());
        }
        finally
        {
            Environment.SetEnvironmentVariable("INTELLIGENCE_API_URL", endpoint);
            Environment.SetEnvironmentVariable("CPK_INTELLIGENCE_API_KEY", key);
        }
        Console.WriteLine("PASS configuration, safe logging, and closed acquisition");
    }

    private sealed class ThrowingWriter : TextWriter
    {
        public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;
        public override void WriteLine(string? value) => throw new IOException("diagnostic sink closed");
    }

    private static HttpResponseMessage Empty()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "snapshots.v1.json")));
        var source = document.RootElement.GetProperty("cases").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "empty");
        var response = new HttpResponseMessage(HttpStatusCode.OK) {
            Content = new ByteArrayContent(Convert.FromBase64String(source.GetProperty("archiveBase64").GetString()!))
        };
        response.Headers.TryAddWithoutValidation("ETag", source.GetProperty("etag").GetString());
        response.Headers.TryAddWithoutValidation("X-CopilotKit-Skills-Revision", source.GetProperty("revision").GetString());
        response.Content.Headers.ContentType = new("application/zip");
        return response;
    }

    private static async Task ThrowsAsync<T>(Func<Task> action) where T : Exception
    {
        try { await action(); }
        catch (T) { return; }
        throw new Exception("Expected " + typeof(T).Name);
    }

    private sealed class SlowContent : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => throw new NotSupportedException();
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context, CancellationToken cancellationToken)
            => Task.Delay(Timeout.Infinite, cancellationToken);
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
    }

    private static void Equal<T>(T actual, T expected)
    {
        if (!EqualityComparer<T>.Default.Equals(actual, expected)) throw new Exception($"Expected {expected}, got {actual}");
    }
    private sealed class Clock : TimeProvider
    {
        internal DateTimeOffset Now = DateTimeOffset.UnixEpoch;
        public override DateTimeOffset GetUtcNow() => Now;
        public override long GetTimestamp() => Now.UtcTicks;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    }
    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request, cancellationToken);
    }
}
