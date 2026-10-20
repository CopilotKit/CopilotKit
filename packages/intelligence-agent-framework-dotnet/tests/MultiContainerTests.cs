using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;

internal static class MultiContainerTests
{
    internal static async Task RunAsync()
    {
        var calls = new ConcurrentQueue<(string Path, string Query, string? ETag)>();
        var phase = 0;
        using var http = new HttpClient(new Handler(request => {
            if (request.Method == HttpMethod.Get) return Reply("text-skill");
            Equal(request.Method, HttpMethod.Post);
            Equal(request.RequestUri!.AbsolutePath, "/api/v1/learning/skills/batch");
            var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            using var posted = JsonDocument.Parse(body);
            calls.Enqueue((request.RequestUri.AbsolutePath, body, null));
            if (phase == 5) throw new HttpRequestException("offline");
            if (phase == 4) return new(HttpStatusCode.Forbidden);
            return Batch(posted.RootElement.GetProperty("containers").EnumerateArray().Select(source => {
                var id = source.GetProperty("containerId").GetString()!;
                if (id == "company" && phase is > 0 and < 4) return (object)new { containerId = id, status = "error", error = new { code = phase == 2 ? "AUTHORIZATION_FAILED" : "NETWORK_ERROR", retryable = phase != 2 } };
                if (phase == 6) return (object)new { containerId = id, status = "unchanged", revision = "r1", etag = source.GetProperty("ifNoneMatch").GetString() };
                return Entry(id, phase == 0 ? "text-skill" : "empty-r2");
            }));
        }));
        using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
        var sources = new List<SkillContainerSource> { new() { Id = "support/é %" }, new() { Id = "company" } };
        var oldContainer = Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID");
        var oldRevision = Environment.GetEnvironmentVariable("CPK_INTELLIGENCE_SKILLS_REVISION");
        try
        {
            Environment.SetEnvironmentVariable("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID", "ignored");
            Environment.SetEnvironmentVariable("CPK_INTELLIGENCE_SKILLS_REVISION", "ignored");
            using var registry = new SkillRegistry(new SkillRegistryOptions { Client = client, Containers = sources, FreshnessWindow = TimeSpan.Zero });
            sources.Clear();
            var original = await registry.AcquireAsync();
            Equal(string.Join(",", original.Skills.Select(x => x.Name)), "company/refund-policy,support%2F%C3%A9%20%25/refund-policy");
            Equal(calls.Count, 1);
            Equal(registry.Status.Revision, null);
            var status = (MultiSkillRegistryStatus)registry.Status;
            Equal(status.Containers.Length, 2);
            Equal(status.Containers[0].Id, "support/é %");
            phase = 6;
            Equal(ReferenceEquals(original, await registry.AcquireAsync()), true);
            phase = 1;
            var updated = await registry.AcquireAsync();
            Equal(updated.Skills.Single().Name, "company/refund-policy");
            Equal(original.Skills.Length, 2);
            Equal(registry.Status.Stale, true);
            Equal(calls.Count, 3);
            Equal(calls.Last().Query.Contains("ifNoneMatch"), true);
            phase = 2;
            await Denied(registry);
            phase = 3;
            await Denied(registry);
            phase = 4;
            await Denied(registry);
            phase = 5;
            await Denied(registry);
            registry.Dispose();
            phase = 0;
            await client.GetLearnedSkillsSnapshotAsync("still-open");

            using var pinned = new SkillRegistry(new SkillRegistryOptions {
                Client = client, Containers = [new() { Id = "one", Revision = "r1" }]
            });
            Equal((await pinned.AcquireAsync()).Skills.Single().Name, "one/refund-policy");
            Equal(pinned.Status.Mode, "pinned");
            Equal(calls.Last().Query.Contains("r1"), true);

            foreach (var options in new[] {
                new SkillRegistryOptions { Client = client, Containers = [] },
                new SkillRegistryOptions { Client = client, Containers = Enumerable.Range(0, 51).Select(i => new SkillContainerSource { Id = i.ToString() }).ToArray() },
                new SkillRegistryOptions { Client = client, Containers = [new() { Id = " " }] },
                new SkillRegistryOptions { Client = client, Containers = [new() { Id = "bad\ud800" }] },
                new SkillRegistryOptions { Client = client, Containers = [new() { Id = "a" }, new() { Id = "a" }] },
                new SkillRegistryOptions { Client = client, Containers = [new() { Id = "a", Revision = "" }] },
                new SkillRegistryOptions { Client = client, Containers = [new() { Id = "a" }], ContainerId = "old" },
                new SkillRegistryOptions { Client = client, Containers = [new() { Id = "a" }], Revision = "old" }
            })
            {
                try { using var invalid = new SkillRegistry(options); throw new Exception("accepted invalid sources"); }
                catch (LearnedSkillsException error) when (error.Code == "INVALID_CONFIG") { }
            }
            phase = 1;
            using var cold = new SkillRegistry(new SkillRegistryOptions { Client = client, Containers = [new() { Id = "a" }, new() { Id = "company" }] });
            try { await cold.AcquireAsync(); throw new Exception("partial cold catalog"); }
            catch (LearnedSkillsException error) when (error.Code == "NETWORK_ERROR") { }
            Equal(cold.Status.Initialized, false);
            phase = 0;
            await cold.AcquireAsync();
            using var selective = JsonDocument.Parse(calls.Last().Query);
            Equal(selective.RootElement.GetProperty("containers").GetArrayLength(), 1);
            Equal(selective.RootElement.GetProperty("containers")[0].GetProperty("containerId").GetString(), "company");
        }
        finally
        {
            Environment.SetEnvironmentVariable("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID", oldContainer);
            Environment.SetEnvironmentVariable("CPK_INTELLIGENCE_SKILLS_REVISION", oldRevision);
        }
        Console.WriteLine("PASS multiple containers, qualified names, source capture, isolated fallback, denial, pins, and ownership");
    }

    internal static async Task ConcurrencyAsync()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var requests = 0;
        using var http = new HttpClient(new AsyncHandler(async token => {
            if (Interlocked.Increment(ref requests) == 1) entered.TrySetResult();
            await release.Task.WaitAsync(token);
            return Batch(new[] { Entry("a", "text-skill"), Entry("b", "text-skill") });
        }));
        using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, http);
        using var registry = new SkillRegistry(new SkillRegistryOptions {
            Client = client, Containers = [new() { Id = "a" }, new() { Id = "b" }]
        });
        using var cancellation = new CancellationTokenSource();
        var first = registry.AcquireAsync(cancellation.Token);
        await entered.Task;
        var second = registry.AcquireAsync();
        cancellation.Cancel();
        try { await first; throw new Exception("waiter cancellation ignored"); }
        catch (OperationCanceledException) { }
        release.SetResult();
        var snapshot = await second;
        Equal(snapshot.Skills.Length, 2);
        Equal(requests, 1);
        Equal(ReferenceEquals(snapshot, await registry.AcquireAsync()), true);

        using var blockedHttp = new HttpClient(new AsyncHandler(async token => {
            await Task.Delay(Timeout.Infinite, token);
            return Reply("empty");
        }));
        using var blockedClient = new IntelligenceClient(new IntelligenceOptions { ApiKey = "test" }, blockedHttp);
        using var closing = new SkillRegistry(new SkillRegistryOptions {
            Client = blockedClient, Containers = [new() { Id = "a" }, new() { Id = "b" }]
        });
        var pending = closing.AcquireAsync();
        closing.Dispose();
        try { await pending.WaitAsync(TimeSpan.FromSeconds(3)); throw new Exception("pending disposal ignored"); }
        catch (OperationCanceledException) { }
        Console.WriteLine("PASS multi-container shared refresh, cancellation, and active disposal");
    }

    private sealed class AsyncHandler(Func<CancellationToken, Task<HttpResponseMessage>> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => reply(token);
    }

    private static async Task Denied(SkillRegistry registry)
    {
        try { await registry.AcquireAsync(); throw new Exception("partial denied catalog"); }
        catch (LearnedSkillsException error) when (error.Code == "AUTHORIZATION_FAILED") { }
    }
    private static void Equal<T>(T actual, T expected)
    {
        if (!EqualityComparer<T>.Default.Equals(actual, expected)) throw new Exception($"Expected {expected}, got {actual}");
    }
    internal static object Entry(string id, string name)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "snapshots.v1.json")));
        var item = document.RootElement.GetProperty("cases").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        return new { containerId = id, status = "snapshot", revision = item.GetProperty("revision").GetString(), etag = item.GetProperty("etag").GetString(), contentType = "application/zip", bytesBase64 = item.GetProperty("archiveBase64").GetString() };
    }
    internal static HttpResponseMessage Batch(IEnumerable<object> entries) => new(HttpStatusCode.OK) {
        Content = new StringContent(JsonSerializer.Serialize(new { containers = entries }), System.Text.Encoding.UTF8, "application/json")
    };

    private static HttpResponseMessage Reply(string name)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "snapshots.v1.json")));
        var item = document.RootElement.GetProperty("cases").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        var response = new HttpResponseMessage(HttpStatusCode.OK) {
            Content = new ByteArrayContent(Convert.FromBase64String(item.GetProperty("archiveBase64").GetString()!))
        };
        response.Headers.TryAddWithoutValidation("ETag", item.GetProperty("etag").GetString());
        response.Headers.TryAddWithoutValidation("X-CopilotKit-Skills-Revision", item.GetProperty("revision").GetString());
        response.Content.Headers.ContentType = new("application/zip");
        return response;
    }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Task.FromResult(reply(request));
    }
}
