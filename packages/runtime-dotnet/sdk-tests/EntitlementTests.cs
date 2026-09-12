using System.Text.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;

internal static class EntitlementTests
{
    internal static async Task RunAsync()
    {
        await NormalizesCurrentAndLegacyResponses();
        await RejectsMalformedAuthority();
        await PreservesStructuredProblems();
        await Task.WhenAll(ClassifiesHttpErrorsBeforeBodyReads(), BoundsTheFullResponse());
        await Task.WhenAll(SharesConcurrentRequests(), SharesCachedSnapshots());
        await Task.WhenAll(DisposalCancelsBorrowedTransportLookup(), LastCancellationDoesNotPoisonCache(), CacheExpiresWithoutOldAuthority());
        await RetainsTheSdkExceptionContract();
    }

    private static async Task NormalizesCurrentAndLegacyResponses()
    {
        const string expected = """{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{"memory":true},"limits":{"threads":100},"planCode":"pro"}}""";
        foreach (var payload in new[] { expected, """{"organizationId":"org","active":true,"source":"managedOrgSubscription","features":{"memory":true},"limits":{"threads":100},"planCode":"pro"}""" })
        {
            using var handler = new CaptureHandler { ResponseBody = payload };
            using var http = new HttpClient(handler);
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "server-key" }, http);
            var result = await sdk.GetRuntimeEntitlementsAsync();

            Check(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(result), JsonNode.Parse(expected)), "current and legacy grants normalize to the published union");
            Check(handler.Method == "GET" && handler.Body is null && handler.Authorization == "Bearer server-key"
                && handler.Url?.EndsWith("/api/entitlements/runtime") == true, "SDK uses a bodyless entitlement GET with server credentials");
        }
    }

    private static async Task RejectsMalformedAuthority()
    {
        foreach (var payload in new[] {
            "null", "[]", "{}", "", "private-provider-content", "{\"status\":0}",
            """{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}""",
            """{"organizationId":null,"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}""",
            """{"status":"ready","extra":true,"entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}}""",
            """{"status":"ready","entitlement":{"active":true,"source":0,"features":{},"limits":{}}}""",
            """{"status":"ready","entitlement":{"active":true,"source":"unknown","features":{},"limits":{}}}""",
            """{"status":"ready","entitlement":{"source":"managedOrgSubscription","features":{},"limits":{}}}""",
            """{"status":"ready","entitlement":{"active":null,"source":"managedOrgSubscription","features":{},"limits":{}}}""",
            """{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":null,"limits":{}}}""",
            """{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{"memory":null},"limits":{}}}""",
            """{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{"threads":null}}}""",
            """{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{"threads":1e400}}}""",
            """{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{},"planCode":null}}""",
            """{"status":"unavailable","error":{"code":"ERROR","message":"retry"}}""",
            """{"status":"unavailable","error":{"code":"ERROR","message":"retry","retryable":null}}""",
            """{"status":"unavailable","error":{"code":"ERROR","message":"retry","retryable":true,"traceId":null}}""",
            """{"status":"unavailable","error":{"code":"ERROR","message":"retry","retryable":true},"entitlement":{}}"""
        })
        {
            using var handler = new CaptureHandler { ResponseBody = payload };
            using var http = new HttpClient(handler);
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
            try { await sdk.GetRuntimeEntitlementsAsync(); throw new Exception("malformed authority became a grant: " + payload); }
            catch (RuntimeEntitlementException error)
            {
                Check(error.StatusCode == 502 && !error.Retryable && error.InnerException is null
                    && !error.ToString().Contains("private-provider-content"), "malformed authority produces a safe nonretryable 502");
            }
        }
    }

    private static async Task PreservesStructuredProblems()
    {
        foreach (var status in new[] { "degraded", "misconfigured", "unavailable" })
        {
            var payload = "{\"status\":\"" + status + "\",\"error\":{\"code\":\"BUSY\",\"message\":\"Try later\",\"retryable\":true,\"requestId\":\"\",\"traceId\":\"trace\"}}";
            using var http = new HttpClient(new CaptureHandler { ResponseBody = payload });
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

            var result = await sdk.GetRuntimeEntitlementsAsync();

            Check(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(result), JsonNode.Parse(payload)), "structured problems retain optional strings and retryability");
        }
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private static async Task RetainsTheSdkExceptionContract()
    {
        using var http = new HttpClient(new CaptureHandler { StatusCode = System.Net.HttpStatusCode.Forbidden });
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        try { await sdk.GetRuntimeEntitlementsAsync(); throw new Exception("rejected request must fail"); }
        catch (RuntimeEntitlementException error)
        {
            Check((Exception)error is IntelligenceException, "entitlement failures retain the common SDK exception contract");
        }
        foreach (var failure in new Exception[] { new HttpRequestException("private-provider-content"), new RuntimeEntitlementException(502, false) })
        {
            failure.Data["private"] = "private-provider-content";
            using var transport = new CaptureHandler { Failure = failure };
            using var client = new HttpClient(transport);
            using var intelligence = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, client);
            RuntimeEntitlementException? previous = null;
            for (var index = 0; index < 2; index++)
            {
                try { await intelligence.GetRuntimeEntitlementsAsync(); throw new Exception("transport failure must reject"); }
                catch (RuntimeEntitlementException error)
                {
                    Check(error.StatusCode == 502 && error.Retryable == (failure is not RuntimeEntitlementException), "typed and generic transport failures retain safe retry classification");
                    Check(error.InnerException is null && error.Data.Count == 0 && !error.ToString().Contains("private-provider-content") && !ReferenceEquals(previous, error), "private transport data stays outside immediate and cached exceptions");
                    previous = error;
                    error.Data["caller"] = "private-provider-content";
                }
            }
            Check(transport.Calls == 1, "custom transport failures share the error cache");
        }
    }

    private static async Task SharesCachedSnapshots()
    {
        using var handler = new CaptureHandler { ResponseBody = """{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{"memory":true},"limits":{"threads":100}}}""" };
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

        var first = await sdk.GetRuntimeEntitlementsAsync();
        var second = await sdk.GetRuntimeEntitlementsAsync();
        var edited = first with { Entitlement = first.Entitlement! with { Active = false } };

        Check(handler.Calls == 1, "repeated entitlement reads share the cache");
        Check(!ReferenceEquals(first, second) && second.Entitlement!.Active && !edited.Entitlement!.Active, "caller records cannot change cached authority");
        Check(first.Entitlement!.Features is System.Collections.Frozen.FrozenDictionary<string, bool>
            && first.Entitlement.Limits is System.Collections.Frozen.FrozenDictionary<string, double>, "SDK snapshots use immutable feature and limit maps");
    }

    private static async Task SharesConcurrentRequests()
    {
        using var handler = new EntitlementGateHandler();
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        using var cancellation = new CancellationTokenSource();
        var first = sdk.GetRuntimeEntitlementsAsync(cancellation.Token);
        await handler.Started.Task;
        var others = Enumerable.Range(0, 7).Select(_ => sdk.GetRuntimeEntitlementsAsync()).ToArray();

        cancellation.Cancel();
        try { await first; throw new Exception("first caller must cancel"); }
        catch (OperationCanceledException) { }
        handler.Release.TrySetResult();
        var results = await Task.WhenAll(others);

        Check(handler.Calls == 1 && results.All(result => result.Status == RuntimeEntitlementStatus.Ready), "concurrent callers share one lookup and cancel independently");
    }

    private sealed class EntitlementGateHandler : HttpMessageHandler
    {
        internal int Calls;
        internal TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal TaskCompletionSource Canceled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            Started.TrySetResult();
            try { await Release.Task.WaitAsync(cancellationToken); }
            catch (OperationCanceledException) { Canceled.TrySetResult(); throw; }
            return new(System.Net.HttpStatusCode.OK) { Content = new StringContent("""{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}}""") };
        }
    }

    private static async Task DisposalCancelsBorrowedTransportLookup()
    {
        using var handler = new EntitlementGateHandler();
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        var request = sdk.GetRuntimeEntitlementsAsync();
        await handler.Started.Task;
        try
        {
            sdk.Dispose();
            await handler.Canceled.Task.WaitAsync(TimeSpan.FromMilliseconds(500));
            try { await request; throw new Exception("disposed lookup returned a grant"); }
            catch (OperationCanceledException) { }
            handler.Release.TrySetResult();
            using var response = await http.GetAsync("https://platform.test");
            Check(response.IsSuccessStatusCode, "SDK disposal leaves the borrowed HTTP client usable");
            try { await sdk.GetRuntimeEntitlementsAsync(); throw new Exception("disposed SDK accepted another call"); }
            catch (ObjectDisposedException) { }
        }
        finally
        {
            handler.Release.TrySetResult();
            try { await request; } catch (Exception) { }
        }
    }

    private static async Task LastCancellationDoesNotPoisonCache()
    {
        using var handler = new EntitlementGateHandler();
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        using var cancellation = new CancellationTokenSource();
        var request = sdk.GetRuntimeEntitlementsAsync(cancellation.Token);
        await handler.Started.Task;

        cancellation.Cancel();
        try { await request; throw new Exception("last caller did not cancel"); }
        catch (OperationCanceledException) { }
        await handler.Canceled.Task.WaitAsync(TimeSpan.FromSeconds(1));
        handler.Release.TrySetResult();
        var next = await sdk.GetRuntimeEntitlementsAsync();

        Check(next.Status == RuntimeEntitlementStatus.Ready && handler.Calls == 2, "last caller cancels unused I/O without caching cancellation");
    }

    private static async Task CacheExpiresWithoutOldAuthority()
    {
        foreach (var active in new[] { true, false })
        {
            var payload = "{\"status\":\"ready\",\"entitlement\":{\"active\":" + (active ? "true" : "false") + ",\"source\":\"managedOrgSubscription\",\"features\":{},\"limits\":{}}}";
            using var handler = new CaptureHandler { ResponseBody = payload };
            handler.Responses.Enqueue((System.Net.HttpStatusCode.OK, payload));
            handler.Responses.Enqueue((System.Net.HttpStatusCode.ServiceUnavailable, "private-provider-content"));
            using var http = new HttpClient(handler);
            var clock = new EntitlementTestClock();
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http) { EntitlementClock = clock };
            await sdk.GetRuntimeEntitlementsAsync();
            clock.Advance(TimeSpan.FromSeconds(active ? 30 : 5) - TimeSpan.FromTicks(1));
            await sdk.GetRuntimeEntitlementsAsync();
            Check(handler.Calls == 1, "grant retains its exact 30/5-second cache lifetime");

            clock.Advance(TimeSpan.FromTicks(1));
            RuntimeEntitlementException? previous = null;
            for (var index = 0; index < 2; index++)
            {
                try { await sdk.GetRuntimeEntitlementsAsync(); throw new Exception("expired grant survived failed refresh"); }
                catch (RuntimeEntitlementException error)
                {
                    Check(error.StatusCode == 503 && error.Retryable && error.InnerException is null && error.Data.Count == 0 && !ReferenceEquals(previous, error), "failure cache returns separate safe exceptions");
                    error.Data["private"] = "caller mutation";
                    previous = error;
                }
            }
            Check(handler.Calls == 2, "failed refresh remains cached for five seconds");
            clock.Advance(TimeSpan.FromSeconds(5));
            await sdk.GetRuntimeEntitlementsAsync();
            Check(handler.Calls == 3, "failure expires at five seconds and permits another lookup");
        }
    }

    private sealed class EntitlementTestClock : TimeProvider
    {
        private long timestamp;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => timestamp;
        internal void Advance(TimeSpan elapsed) => timestamp += elapsed.Ticks;
    }

    private static async Task ClassifiesHttpErrorsBeforeBodyReads()
    {
        foreach (var status in new[] { 301, 307, 400, 401, 403, 404, 408, 425, 429, 500, 503 })
        {
            using var stream = new PendingEntitlementStream();
            using var http = new HttpClient(new EntitlementStreamHandler(status, stream));
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

            try { await sdk.GetRuntimeEntitlementsAsync(); throw new Exception("rejected entitlement must fail"); }
            catch (RuntimeEntitlementException error)
            {
                Check(error.StatusCode == status && error.Retryable == (status is 408 or 425 or 429 || status >= 500), "HTTP entitlement error keeps status and retryability: " + status);
                Check(!stream.Started.Task.IsCompleted && stream.Disposed, "rejected body closes without a read");
                Check(error.InnerException is null, "transport details remain private");
            }
        }
    }

    private static async Task BoundsTheFullResponse()
    {
        foreach (var configured in new[] { TimeSpan.FromSeconds(3), TimeSpan.FromMilliseconds(50) })
        {
            using var stream = new PendingEntitlementStream();
            using var http = new HttpClient(new EntitlementStreamHandler(200, stream));
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key", RequestTimeout = configured }, http);
            var started = System.Diagnostics.Stopwatch.StartNew();

            try { await sdk.GetRuntimeEntitlementsAsync(); throw new Exception("entitlement response must time out"); }
            catch (RuntimeEntitlementException error)
            {
                Check(error.StatusCode == 504 && error.Retryable, "body timeout becomes a retryable 504");
                Check(started.Elapsed < (configured.TotalSeconds > 1 ? TimeSpan.FromSeconds(2.5) : TimeSpan.FromSeconds(1)), "the shorter SDK deadline and 1.5-second cap cover body reads");
                Check(stream.Disposed, "timed-out body closes");
            }
        }
    }

    private sealed class EntitlementStreamHandler(int status, Stream body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage((System.Net.HttpStatusCode)status) { Content = new StreamContent(body) });
    }

    private sealed class PendingEntitlementStream : Stream
    {
        internal TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal bool Disposed { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Started.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return 0;
        }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
    }
}
