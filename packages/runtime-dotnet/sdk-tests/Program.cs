using System.Net;
using System.Net.Sockets;
using System.Text;
using CopilotKit.Intelligence;

var tests = new Func<Task>[] { ReadsScopedThread, RejectsInvalidConfiguration, RejectsInvalidIdentifiers,
    RejectsMalformedResponses, RedactsPlatformErrors, RedactsTransportErrors, PreservesCancellation,
    BoundsRequestTime, BoundsResponseSize, PreservesBorrowedClient, RejectsCallsAfterDisposal, BlocksRedirects, ResourceTests.RunAsync, LifecycleTests.RunAsync, InspectorTests.RunAsync, EntitlementTests.RunAsync, MemoryResultTests.RunAsync, HistoryResultTests.RunAsync, ThreadResultTests.RunAsync, LearnedSkillsTests.RunAsync };
var failures = 0;
foreach (var test in tests)
{
    try { await test(); }
    catch (Exception error) { failures++; Console.Error.WriteLine($"FAIL {test.Method.Name}: {error}"); }
}
return failures == 0 ? 0 : 1;

static IntelligenceOptions Options(Uri? apiUrl = null, TimeSpan? timeout = null) => new()
{
    ApiKey = "test-key", ApiUrl = apiUrl ?? new Uri("https://platform.test"),
    RequestTimeout = timeout ?? TimeSpan.FromSeconds(30)
};

static async Task<T> Throws<T>(Func<Task> action) where T : Exception
{
    try { await action(); }
    catch (T error) { return error; }
    throw new Exception($"Expected {typeof(T).Name}");
}

static async Task RejectsInvalidConfiguration()
{
    using var http = new HttpClient(new CaptureHandler());
    foreach (var endpoint in new[] { "relative", "ftp://platform.test", "https://key@platform.test", "https://platform.test?q=secret", "https://platform.test/#secret" })
    {
        await Throws<ArgumentException>(() => { using var client = new IntelligenceClient(Options(new Uri(endpoint, UriKind.RelativeOrAbsolute)), http); return Task.CompletedTask; });
    }
    await Throws<ArgumentException>(() => { using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = " " }, http); return Task.CompletedTask; });
    foreach (var timeout in new[] { TimeSpan.Zero, TimeSpan.FromSeconds(-1), TimeSpan.MaxValue })
    {
        await Throws<ArgumentException>(() => { using var client = new IntelligenceClient(Options(timeout: timeout), http); return Task.CompletedTask; });
    }
    foreach (var endpoint in new[] { "relative", "ftp://gateway.test", "wss://key@gateway.test", "wss://gateway.test?q=secret", "wss://gateway.test/#secret" })
    {
        var uri = new Uri(endpoint, UriKind.RelativeOrAbsolute);
        await Throws<ArgumentException>(() => { using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key", RunnerUrl = uri }, http); return Task.CompletedTask; });
        await Throws<ArgumentException>(() => { using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key", ClientUrl = uri }, http); return Task.CompletedTask; });
    }
    Check(true, "invalid credentials, endpoints, and deadlines fail before I/O");
}

static async Task RejectsInvalidIdentifiers()
{
    using var handler = new CaptureHandler();
    using var http = new HttpClient(handler);
    using var client = new IntelligenceClient(Options(), http);

    foreach (var id in new[] { "", " ", ".", ".." })
        await Throws<ArgumentException>(() => client.GetThreadAsync(id, "customer"));
    await Throws<ArgumentException>(() => client.GetThreadAsync("thread", " "));

    Check(handler.Calls == 0, "invalid identifiers fail before I/O");
}

static async Task RejectsMalformedResponses()
{
    foreach (var body in new[] { "", "not-json", "[]", "null", "{\"thread\":{}}", "{\"thread\":{\"id\":2}}", "{\"thread\":{\"id\":\" \"}}" })
    {
        using var handler = new CaptureHandler { ResponseBody = body };
        using var http = new HttpClient(handler);
        using var client = new IntelligenceClient(Options(), http);

        var error = await Throws<IntelligenceException>(() => client.GetThreadAsync("thread", "customer"));

        Check(error.StatusCode == 502, "malformed thread response fails with a typed error");
    }
}

static async Task RedactsPlatformErrors()
{
    foreach (var status in new[] { 401, 403, 404, 409, 429, 503 })
    {
        using var handler = new CaptureHandler { StatusCode = (HttpStatusCode)status, ResponseBody = "private upstream response test-key" };
        using var http = new HttpClient(handler);
        using var client = new IntelligenceClient(Options(), http);

        var error = await Throws<IntelligenceException>(() => client.GetThreadAsync("thread", "customer"));

        Check(error.StatusCode == status && !error.ToString().Contains("private upstream") && !error.ToString().Contains("test-key"), "platform errors retain status without response content");
        Check(handler.Calls == 1, "SDK does not retry rejected requests");
    }
}

static async Task RedactsTransportErrors()
{
    using var http = new HttpClient(new CaptureHandler { Failure = new HttpRequestException("private transport test-key") });
    using var client = new IntelligenceClient(Options(), http);

    var error = await Throws<IntelligenceException>(() => client.GetThreadAsync("thread", "customer"));

    Check(error.StatusCode == 502 && !error.ToString().Contains("test-key"), "transport errors do not disclose private details");
}

static async Task PreservesCancellation()
{
    using var handler = new CaptureHandler { WaitForCancellation = true };
    using var http = new HttpClient(handler);
    using var client = new IntelligenceClient(Options(), http);
    using var cancellation = new CancellationTokenSource();

    var request = client.GetThreadAsync("thread", "customer", cancellation.Token);
    await handler.Started.Task;
    cancellation.Cancel();
    await Throws<OperationCanceledException>(() => request);

    Check(handler.Calls == 1, "caller cancellation reaches the HTTP transport");
}

static async Task BoundsRequestTime()
{
    using var handler = new CaptureHandler { WaitForCancellation = true };
    using var http = new HttpClient(handler);
    using var client = new IntelligenceClient(Options(timeout: TimeSpan.FromMilliseconds(25)), http);

    await Throws<OperationCanceledException>(() => client.GetThreadAsync("thread", "customer"));

    Check(handler.Calls == 1, "SDK deadline cancels the request without retry");
}

static async Task PreservesBorrowedClient()
{
    using var handler = new CaptureHandler();
    using var http = new HttpClient(handler);
    var client = new IntelligenceClient(Options(), http);

    client.Dispose();
    using var response = await http.GetAsync("https://platform.test/health");

    Check(!handler.Disposed && response.IsSuccessStatusCode, "SDK disposal leaves the supplied HTTP client usable");
}

static async Task BoundsResponseSize()
{
    using var handler = new CaptureHandler
    {
        ResponseBody = "{\"thread\":{\"id\":\"thread\",\"large\":\"" + new string('x', 16 * 1024 * 1024) + "\"}}"
    };
    using var http = new HttpClient(handler);
    using var client = new IntelligenceClient(Options(), http);

    var error = await Throws<IntelligenceException>(() => client.GetThreadAsync("thread", "customer"));

    Check(error.StatusCode == 502, "SDK rejects responses larger than 16 MiB");
}

static async Task RejectsCallsAfterDisposal()
{
    using var handler = new CaptureHandler();
    using var http = new HttpClient(handler);
    var client = new IntelligenceClient(Options(), http);
    client.Dispose();
    client.Dispose();

    await Throws<ObjectDisposedException>(() => client.GetThreadAsync("thread", "customer"));

    Check(handler.Calls == 0, "disposed SDK rejects requests even with a borrowed client");
}

static async Task BlocksRedirects()
{
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var endpoint = new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}");
    using var client = new IntelligenceClient(Options(endpoint));
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var request = client.GetThreadAsync("thread", "customer", deadline.Token);
    using var socket = await listener.AcceptTcpClientAsync(deadline.Token);
    await using var stream = socket.GetStream();
    using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);
    while (await reader.ReadLineAsync(deadline.Token) is { Length: > 0 }) { }
    await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 302 Found\r\nLocation: {endpoint}redirected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"), deadline.Token);
    socket.Close();

    var error = await Throws<IntelligenceException>(() => request);

    Check(error.StatusCode == 302 && !listener.Pending(), "default transport rejects redirects without a second connection");
}

static async Task ReadsScopedThread()
{
    using var handler = new CaptureHandler();
    using var http = new HttpClient(handler);
    using var client = new IntelligenceClient(new IntelligenceOptions
    {
        ApiKey = "test-key", ApiUrl = new Uri("https://platform.test/prefix")
    }, http);

    var thread = await client.GetThreadAsync("thread/id", "customer?one");

    Check(thread.Id == "canonical", "SDK unwraps the thread envelope");
    Check(thread.ExtensionData["extension"].GetProperty("preserved").GetBoolean(), "SDK retains platform fields");
    Check(handler.Url == "https://platform.test/prefix/api/threads/thread%2Fid?userId=customer%3Fone", "SDK encodes scoped thread identifiers");
    Check(handler.Authorization == "Bearer test-key", "SDK authenticates platform calls");
    Check(handler.Body is null, "SDK GET has no body");
    Check(typeof(IntelligenceClient).Assembly.GetReferencedAssemblies().All(name => !name.Name!.Contains("AspNetCore") && name.Name != "CopilotKit.Intelligence.Runtime"), "SDK assembly has no Runtime or ASP.NET Core reference");
}

static void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}

sealed class CaptureHandler : HttpMessageHandler
{
    internal string ResponseBody { get; init; } = "{\"thread\":{\"id\":\"canonical\",\"extension\":{\"preserved\":true}}}";
    internal HttpStatusCode StatusCode { get; init; } = HttpStatusCode.OK;
    internal Exception? Failure { get; init; }
    internal bool WaitForCancellation { get; init; }
    internal bool Disposed { get; private set; }
    internal int Calls { get; private set; }
    internal TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal string? Url { get; private set; }
    internal string? Authorization { get; private set; }
    internal string? Body { get; private set; }
    internal string? Method { get; private set; }
    internal Dictionary<string, string> Headers { get; } = [];
    internal Queue<(HttpStatusCode Status, string Body)> Responses { get; } = new();
    internal List<(string Method, string Url, string? Body)> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++;
        Started.TrySetResult();
        if (WaitForCancellation) await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        if (Failure is not null) throw Failure;
        Url = request.RequestUri!.AbsoluteUri;
        Authorization = request.Headers.Authorization?.ToString();
        Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        Method = request.Method.Method;
        foreach (var header in request.Headers) Headers[header.Key] = string.Join(",", header.Value);
        Requests.Add((Method, Url, Body));
        var response = Responses.Count > 0 ? Responses.Dequeue() : (StatusCode, ResponseBody);
        return new HttpResponseMessage(response.Item1)
        {
            Content = new StringContent(response.Item2)
        };
    }

    protected override void Dispose(bool disposing)
    {
        Disposed = true;
        base.Dispose(disposing);
    }
}
