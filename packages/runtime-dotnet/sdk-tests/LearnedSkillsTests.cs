using System.Net;
using System.Text;
using CopilotKit.Intelligence;

internal static class LearnedSkillsTests
{
    private static readonly string Etag = "\"" + new string('a', 64) + "\"";
    internal static async Task RunAsync()
    {
        await ReadsRawSnapshot();
        await DoesNotReadUnchangedBody();
        await RejectsInvalidMetadata();
        await PreservesDenials();
        await PreservesCancellationAndTimeout();
        await PreservesStalledDenial();
        await PreservesStructuredErrors();
        Console.WriteLine("PASS learned skill raw transport");
    }

    private static IntelligenceClient Client(HttpClient http, TimeSpan? timeout = null) => new(new IntelligenceOptions
    {
        ApiKey = "private-key", ApiUrl = new Uri("https://platform.test/base/"),
        RequestTimeout = timeout ?? TimeSpan.FromSeconds(30)
    }, http);

    private static HttpResponseMessage Snapshot(HttpStatusCode status = HttpStatusCode.OK)
    {
        var response = new HttpResponseMessage(status) { Content = new ByteArrayContent([80, 75, 0, 255]) };
        response.Headers.TryAddWithoutValidation("X-CopilotKit-Skills-Revision", "opaque /+?");
        response.Headers.TryAddWithoutValidation("ETag", Etag);
        response.Content.Headers.ContentType = new("application/zip");
        return response;
    }

    private static async Task ReadsRawSnapshot()
    {
        var calls = 0;
        using var http = new HttpClient(new Handler((request, _) =>
        {
            calls++;
            if (calls > 2) return Task.FromResult(Snapshot());
            Check(request.Method == HttpMethod.Get, "GET request");
            Check(request.RequestUri!.AbsoluteUri == "https://platform.test/base/api/v1/learning/containers/folder%2Fid/skills?revision=opaque%20%2F%2B%3F", "opaque path and revision");
            Check(request.Headers.Authorization?.ToString() == "Bearer private-key", "canonical credential");
            Check(request.Headers.IfNoneMatch.Single().ToString() == Etag, "conditional header");
            return Task.FromResult(Snapshot());
        }));
        using (var client = Client(http))
        {
            for (var i = 0; i < 2; i++)
            {
                var result = await client.GetLearnedSkillsSnapshotAsync("folder/id", "opaque /+?", Etag);
                Check(result is LearnedSkillsSnapshot snapshot && snapshot.Bytes.SequenceEqual(new byte[] { 80, 75, 0, 255 })
                    && snapshot.Revision == "opaque /+?" && snapshot.ETag == Etag && snapshot.ContentType == "application/zip", "raw typed snapshot");
            }
        }
        Check(calls == 2, "no cache or retry");
        using var stillOpen = await http.GetAsync("https://platform.test/base/api/v1/learning/containers/folder%2Fid/skills?revision=opaque%20%2F%2B%3F");
    }

    private static async Task DoesNotReadUnchangedBody()
    {
        using var http = new HttpClient(new Handler((_, _) =>
        {
            var response = Snapshot(HttpStatusCode.NotModified);
            response.Content = new StreamContent(new BrokenStream());
            return Task.FromResult(response);
        }));
        using var client = Client(http);
        Check(await client.GetLearnedSkillsSnapshotAsync("c", ifNoneMatch: Etag) is LearnedSkillsUnchanged, "304 is distinct and unread");
        await Error(() => client.GetLearnedSkillsSnapshotAsync("c"), "INVALID_SNAPSHOT", false);
    }

    private static async Task RejectsInvalidMetadata()
    {
        foreach (var header in new[] { "ETag", "X-CopilotKit-Skills-Revision", "Content-Type" })
        {
            using var http = new HttpClient(new Handler((_, _) =>
            {
                var response = Snapshot();
                if (header == "Content-Type") response.Content.Headers.Remove(header);
                else response.Headers.Remove(header);
                return Task.FromResult(response);
            }));
            using var client = Client(http);
            await Error(() => client.GetLearnedSkillsSnapshotAsync("c"), "INVALID_SNAPSHOT", false);
        }
        using var validHttp = new HttpClient(new Handler((_, _) => Task.FromResult(Snapshot())));
        using var validClient = Client(validHttp);
        await Error(() => validClient.GetLearnedSkillsSnapshotAsync("c", revision: "different"), "INVALID_SNAPSHOT", false);
        foreach (var id in new[] { "", " ", ".", ".." })
            await Error(() => validClient.GetLearnedSkillsSnapshotAsync(id), "INVALID_CONFIG", false);
    }

    private static async Task PreservesDenials()
    {
        foreach (var status in new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden })
        foreach (var body in new[] { "private-key bad JSON", "{}", "{\"error\":{\"code\":\"NETWORK_ERROR\",\"retryable\":true}}", "broken" })
        {
            using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(status)
            {
                Content = body == "broken" ? new StreamContent(new BrokenStream()) : new StringContent(body)
            })));
            using var client = Client(http);
            var error = await Error(() => client.GetLearnedSkillsSnapshotAsync("c"), status == HttpStatusCode.Unauthorized ? "AUTHENTICATION_FAILED" : "AUTHORIZATION_FAILED", false);
            Check(!error.ToString().Contains("private-key"), "safe error display");
        }
    }

    private static async Task PreservesCancellationAndTimeout()
    {
        using var http = new HttpClient(new Handler(async (_, token) => { await Task.Delay(Timeout.Infinite, token); return Snapshot(); }));
        using var client = Client(http, TimeSpan.FromMilliseconds(30));
        await Error(() => client.GetLearnedSkillsSnapshotAsync("c"), "TIMEOUT", true);
        using var cancel = new CancellationTokenSource(); cancel.Cancel();
        try { await client.GetLearnedSkillsSnapshotAsync("c", cancellationToken: cancel.Token); }
        catch (OperationCanceledException) { return; }
        throw new Exception("caller cancellation did not propagate");
    }

    private static async Task PreservesStructuredErrors()
    {
        foreach (var code in new[] { "ENTITLEMENT_REQUIRED", "DELIVERY_DISABLED", "REVISION_REVOKED", "CONTAINER_NOT_FOUND", "REVISION_NOT_FOUND" })
        {
            using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden)
            { Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(new { error = new { code, message = "private-key", category = "permanent", retryable = false } })) })));
            using var client = Client(http);
            await Error(() => client.GetLearnedSkillsSnapshotAsync("c"), code, false);
        }
        using var validHttp = new HttpClient(new Handler((_, _) => Task.FromResult(Snapshot())));
        using var validClient = Client(validHttp);
        await Error(() => validClient.GetLearnedSkillsSnapshotAsync("c", ifNoneMatch: Etag + "\n"), "INVALID_CONFIG", false);
    }

    private static async Task PreservesStalledDenial()
    {
        foreach (var status in new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden })
        {
            using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(status)
            { Content = new StreamContent(new StalledStream()) })));
            using var client = Client(http, TimeSpan.FromMilliseconds(25));
            await Error(() => client.GetLearnedSkillsSnapshotAsync("c"), status == HttpStatusCode.Unauthorized ? "AUTHENTICATION_FAILED" : "AUTHORIZATION_FAILED", false);
        }
    }
    private sealed class StalledStream : MemoryStream
    {
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        { await Task.Delay(Timeout.Infinite, cancellationToken); return 0; }
        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        { await Task.Delay(Timeout.Infinite, cancellationToken); return 0; }
    }

    private static async Task<LearnedSkillsException> Error(Func<Task<LearnedSkillsResult>> call, string code, bool retryable)
    {
        try { await call(); }
        catch (LearnedSkillsException error) { Check(error.Code == code && error.Retryable == retryable, "typed " + code); return error; }
        throw new Exception("expected " + code);
    }
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request, cancellationToken);
    }
    private sealed class BrokenStream : MemoryStream
    {
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => ValueTask.FromException<int>(new IOException("private-key broken body"));
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) => Task.FromException<int>(new IOException("private-key broken body"));
    }
}
