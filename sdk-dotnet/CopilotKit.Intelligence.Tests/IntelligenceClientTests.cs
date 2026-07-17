using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Xunit;

namespace CopilotKit.Intelligence.Tests;

public sealed class IntelligenceClientTests : IDisposable
{
    private const string ContainerId = "55555555-5555-4555-8555-555555555555";
    private const string SkillId = "99999999-9999-4999-8999-999999999999";
    private const string VersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    private readonly string _cacheRoot = Path.Combine(Path.GetTempPath(), $"copilotkit-dotnet-{Guid.NewGuid():N}");

    [Fact]
    public async Task SharedGoldenProjectionUsesCanonicalV1HttpContract()
    {
        var golden = GoldenRegistryFixture();
        var projection = golden["projection"]!.AsObject();
        var archive = Convert.FromBase64String(golden["bundle"]!["base64"]!.GetValue<string>());
        var handler = new QueueHandler(Json(projection), Bytes(archive));
        using var client = GoldenClient(handler, golden);

        var result = await client.GetAsync(golden["identity"]!["learningContainerId"]!.GetValue<string>());

        Assert.Equal(CacheFreshness.Fresh, result.Freshness);
        Assert.Equal(
            golden["identity"]!["baseUrl"]!.GetValue<string>() + golden["http"]!["projectionPath"]!.GetValue<string>(),
            handler.Requests[0].RequestUri!.ToString());
        Assert.Equal(golden["http"]!["authorization"]!.GetValue<string>(), handler.Requests[0].Headers.Authorization!.ToString());
        Assert.Equal(
            golden["bundle"]!["fileContents"]!.GetValue<string>(),
            await File.ReadAllTextAsync(Path.Combine(result.Skills[0].Directory, golden["bundle"]!["filePath"]!.GetValue<string>())));
    }

    [Fact]
    public async Task GoldenOpaqueEtagProducesFreshVerified304()
    {
        var golden = GoldenRegistryFixture();
        var projection = golden["projection"]!.AsObject();
        var archive = Convert.FromBase64String(golden["bundle"]!["base64"]!.GetValue<string>());
        using (var initial = GoldenClient(new QueueHandler(Json(projection), Bytes(archive)), golden))
            await initial.GetAsync(golden["identity"]!["learningContainerId"]!.GetValue<string>());

        var handler = new QueueHandler(new HttpResponseMessage(HttpStatusCode.NotModified));
        using var conditional = GoldenClient(handler, golden);
        var result = await conditional.GetAsync(golden["identity"]!["learningContainerId"]!.GetValue<string>());

        Assert.Equal(CacheFreshness.Fresh, result.Freshness);
        Assert.Equal(golden["http"]!["ifNoneMatch"]!.GetValue<string>(), handler.Requests[0].Headers.GetValues("If-None-Match").Single());
    }

    [Fact]
    public async Task NoncanonicalContainerIdFailsBeforeDotnetTransport()
    {
        var golden = GoldenRegistryFixture();
        var handler = new QueueHandler(Json(golden["projection"]!.AsObject()));
        using var client = GoldenClient(handler, golden);

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() =>
            client.GetAsync("55555555-5555-4555-1555-555555555555"));

        Assert.Equal(IntelligenceErrorCodes.RegistryUnrecoverable, error.Code);
        Assert.Equal("validation", error.Category);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task UnknownGoldenErrorCodeFailsAsNoncanonical()
    {
        var golden = GoldenRegistryFixture();
        var unknown = golden["errors"]!["unknownCode"]!.AsObject();
        var status = (HttpStatusCode)unknown["status"]!.GetValue<int>();
        using var client = GoldenClient(new QueueHandler(Json(unknown["body"]!, status)), golden);

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() =>
            client.GetAsync(golden["identity"]!["learningContainerId"]!.GetValue<string>()));

        Assert.Equal(golden["expectations"]!["nonCanonicalErrorCode"]!.GetValue<string>(), error.Code);
        Assert.Equal("dependency", error.Category);
    }

    [Fact]
    public async Task GoldenConflictPreservesCacheButGoldenDenialInvalidatesIt()
    {
        var golden = GoldenRegistryFixture();
        var archive = Convert.FromBase64String(golden["bundle"]!["base64"]!.GetValue<string>());
        using (var online = GoldenClient(new QueueHandler(Json(golden["projection"]!), Bytes(archive)), golden))
            await online.GetAsync(golden["identity"]!["learningContainerId"]!.GetValue<string>());

        var conflict = golden["errors"]!["canonicalConflict"]!.AsObject();
        using (var conflicting = GoldenClient(new QueueHandler(Json(
            conflict["body"]!, (HttpStatusCode)conflict["status"]!.GetValue<int>())), golden))
        {
            var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => conflicting.GetAsync(ContainerId));
            Assert.Equal(conflict["body"]!["error"]!["code"]!.GetValue<string>(), error.Code);
            Assert.Equal(conflict["body"]!["requestId"]!.GetValue<string>(), error.RequestId);
            Assert.Equal(CacheFreshness.Cached, (await conflicting.GetCachedAsync(ContainerId)).Freshness);
        }

        var denial = golden["errors"]!["canonicalDenial"]!.AsObject();
        using var denied = GoldenClient(new QueueHandler(Json(
            denial["body"]!, (HttpStatusCode)denial["status"]!.GetValue<int>())), golden);
        var deniedError = await Assert.ThrowsAsync<IntelligenceSdkException>(() => denied.GetAsync(ContainerId));
        Assert.Equal(denial["body"]!["error"]!["code"]!.GetValue<string>(), deniedError.Code);
        await Assert.ThrowsAsync<IntelligenceSdkException>(() => denied.GetCachedAsync(ContainerId));
    }

    [Fact]
    public async Task GoldenMalformedErrorFailsAsNoncanonical()
    {
        var golden = GoldenRegistryFixture();
        var malformed = golden["errors"]!["malformed"]!.AsObject();
        using var client = GoldenClient(new QueueHandler(Json(
            malformed["body"]!, (HttpStatusCode)malformed["status"]!.GetValue<int>())), golden);

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));

        Assert.Equal(golden["expectations"]!["nonCanonicalErrorCode"]!.GetValue<string>(), error.Code);
        Assert.Equal("dependency", error.Category);
    }

    [Fact]
    public async Task ArtifactManifestIsNotAcceptedAsALegacyAlias()
    {
        var golden = GoldenRegistryFixture();
        var projection = golden["projection"]!.DeepClone().AsObject();
        var entry = projection["entries"]![0]!.AsObject();
        entry["artifactManifest"] = entry["manifest"]!.DeepClone();
        entry.Remove("manifest");
        using var client = GoldenClient(new QueueHandler(Json(projection)), golden);

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));

        Assert.Equal(IntelligenceErrorCodes.BlobIntegrityFailure, error.Code);
    }

    [Fact]
    public async Task GetAsync_UsesBearerAuthPreservesUnknownJsonAndMaterializesSkill()
    {
        var fixture = CreateFixture();
        var handler = new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive));
        using var client = Client(handler);

        var result = await client.GetAsync(ContainerId);

        Assert.Equal(CacheFreshness.Fresh, result.Freshness);
        Assert.True(result.Projection.ExtensionData!.ContainsKey("futureProjectionField"));
        Assert.True(result.Projection.Entries[0].ExtensionData!.ContainsKey("futureEntryField"));
        Assert.Equal("# Skill\n", await File.ReadAllTextAsync(Path.Combine(result.Skills[0].Directory, "SKILL.md")));
        Assert.Equal("Bearer", handler.Requests[0].Headers.Authorization!.Scheme);
        Assert.Equal("secret-token", handler.Requests[0].Headers.Authorization!.Parameter);
        Assert.Equal("application/json, application/zip", string.Join(", ", handler.Requests[0].Headers.Accept.Select(value => value.MediaType)));
    }

    [Fact]
    public async Task GetAsync_On304FullyVerifiesCacheAndRefetchesUnconditionallyOnceWhenCorrupt()
    {
        var fixture = CreateFixture();
        using (var initial = Client(new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive))))
        {
            var installed = await initial.GetAsync(ContainerId);
            await File.WriteAllTextAsync(Path.Combine(installed.Skills[0].Directory, "SKILL.md"), "corrupt");
        }

        var handler = new QueueHandler(
            new HttpResponseMessage(HttpStatusCode.NotModified),
            Json(fixture.Projection),
            Bytes(fixture.Archive));
        using var repairing = Client(handler);
        var repaired = await repairing.GetAsync(ContainerId);

        Assert.Equal(3, handler.Requests.Count);
        Assert.Equal("\"registry-1\"", handler.Requests[0].Headers.IfNoneMatch.Single().Tag);
        Assert.Empty(handler.Requests[1].Headers.IfNoneMatch);
        Assert.Equal("# Skill\n", await File.ReadAllTextAsync(Path.Combine(repaired.Skills[0].Directory, "SKILL.md")));
    }

    [Fact]
    public async Task GetAsync_RejectsProjectionIdentityAndOrderMismatches()
    {
        foreach (var projection in new[]
        {
            CreateFixture(projectionMutation: node => node["learningContainerId"] = SkillId).Projection,
            CreateFixture(projectionMutation: node => node["entries"]![0]!["position"] = 1).Projection,
            CreateFixture(projectionMutation: node => node["entries"]![0]!["bundleSha256"] = new string('0', 64)).Projection,
        })
        {
            using var client = Client(new QueueHandler(Json(projection)));
            await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));
        }
    }

    [Theory]
    [InlineData("../SKILL.md")]
    [InlineData("/safe/SKILL.md")]
    [InlineData("safe\\SKILL.md")]
    public async Task GetAsync_RejectsUnsafeZipPaths(string archivePath)
    {
        var fixture = CreateFixture(new[] { (archivePath, Encoding.UTF8.GetBytes("# Skill\n")) });
        using var client = Client(new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive)));
        var exception = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));
        Assert.Equal(IntelligenceErrorCodes.BlobIntegrityFailure, exception.Code);
    }

    [Fact]
    public async Task GetAsync_RejectsCaseCollisionsManifestOrderMissingSkillAndBounds()
    {
        var cases = new[]
        {
            CreateFixture(new[] { ("safe/SKILL.md", Array.Empty<byte>()), ("safe/skill.md", Array.Empty<byte>()) }),
            CreateFixture(
                new[] { ("safe/a.md", Encoding.UTF8.GetBytes("a")), ("safe/SKILL.md", Encoding.UTF8.GetBytes("# Skill\n")) },
                manifestOrder: new[] { "SKILL.md", "a.md" }),
            CreateFixture(new[] { ("safe/README.md", Array.Empty<byte>()) }),
            CreateFixture(new[] { ("safe/SKILL.md", new byte[101]) }),
        };

        foreach (var fixture in cases)
        {
            using var client = Client(new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive)), new IntelligenceSdkLimits(MaxFileBytes: 100));
            await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));
        }
    }

    [Fact]
    public async Task GetAsync_VerifiesBundleManifestAndFileIntegrity()
    {
        var corruptions = new Action<JsonObject>[]
        {
            node => node["entries"]![0]!["bundleByteLength"] = 1,
            node => node["entries"]![0]!["manifest"]!["files"]![0]!["rawSha256"] = new string('0', 64),
            node => node["entries"]![0]!["manifestSha256"] = new string('0', 64),
        };
        foreach (var corruption in corruptions)
        {
            var fixture = CreateFixture(projectionMutation: corruption);
            using var client = Client(new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive)));
            await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));
        }
    }

    [Fact]
    public async Task ConcurrentInstallersAtomicallyConvergeOnOneVerifiedContentAddressedSet()
    {
        var fixture = CreateFixture();
        var handler = new RepeatingHandler(fixture);
        using var left = Client(handler);
        using var right = Client(handler);

        var results = await Task.WhenAll(left.GetAsync(ContainerId), right.GetAsync(ContainerId));

        Assert.Equal(results[0].Directory, results[1].Directory);
        Assert.DoesNotContain(Directory.EnumerateDirectories(Path.GetDirectoryName(results[0].Directory)!), path => path.Contains(".staging-", StringComparison.Ordinal));
        Assert.True(File.Exists(Path.Combine(results[0].Skills[0].Directory, "SKILL.md")));
    }

    [Fact]
    public async Task RegistryRevisionIsNotCacheKeyAndPointerCarriesLatestProjection()
    {
        var firstFixture = CreateFixture();
        using var first = Client(new QueueHandler(Json(firstFixture.Projection), Bytes(firstFixture.Archive)));
        var initial = await first.GetAsync(ContainerId);

        var secondProjection = (JsonObject)firstFixture.Projection.DeepClone();
        secondProjection["registryRevision"] = "revision-2";
        secondProjection["etag"] = "\"registry-2\"";
        using var second = Client(new QueueHandler(Json(secondProjection)));
        var next = await second.GetAsync(ContainerId);
        var cached = await second.GetCachedAsync(ContainerId);

        Assert.Equal(initial.Directory, next.Directory);
        Assert.Equal("revision-2", next.Projection.RegistryRevision);
        Assert.Equal("revision-2", cached.Projection.RegistryRevision);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task EmptyAndRevokedProjectionsAreValid(bool revoked)
    {
        var fixture = CreateFixture(empty: true, revoked: revoked);
        using var client = Client(new QueueHandler(Json(fixture.Projection)));
        var result = await client.GetAsync(ContainerId);
        Assert.Empty(result.Skills);
        Assert.Equal(revoked, result.Projection.Revoked);
    }

    [Fact]
    public async Task GetAsyncNeverImplicitlyFallsBackButGetCachedAsyncExplicitlyVerifiesOfflineCache()
    {
        var fixture = CreateFixture();
        using (var online = Client(new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive))))
            await online.GetAsync(ContainerId);

        using var offline = Client(new ThrowingHandler(new HttpRequestException("offline")));
        await Assert.ThrowsAsync<IntelligenceSdkException>(() => offline.GetAsync(ContainerId));
        var cached = await offline.GetCachedAsync(ContainerId);
        Assert.Equal(CacheFreshness.Cached, cached.Freshness);
    }

    [Fact]
    public async Task DenialInvalidatesPointerAndBlocksExplicitCachedConsumption()
    {
        var fixture = CreateFixture();
        using (var online = Client(new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive))))
            await online.GetAsync(ContainerId);

        using var denied = Client(new QueueHandler(Json(new JsonObject
        {
            ["error"] = new JsonObject
            {
                ["code"] = "LEARNING_REGISTRY_UNRECOVERABLE",
                ["message"] = "denied",
                ["category"] = "permission",
                ["retryable"] = false,
            },
            ["requestId"] = "request-1",
            ["traceId"] = "trace-1",
        }, HttpStatusCode.Forbidden)));

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => denied.GetAsync(ContainerId));
        Assert.Equal(IntelligenceErrorCodes.RegistryUnrecoverable, error.Code);
        Assert.Equal("request-1", error.RequestId);
        await Assert.ThrowsAsync<IntelligenceSdkException>(() => denied.GetCachedAsync(ContainerId));
    }

    [Fact]
    public async Task GetAsyncHonorsCancellationWithoutBlockingTransport()
    {
        using var client = Client(new CancellingHandler());
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.GetAsync(ContainerId, cancellation.Token));
    }

    public void Dispose()
    {
        if (Directory.Exists(_cacheRoot)) Directory.Delete(_cacheRoot, recursive: true);
    }

    private IntelligenceClient Client(HttpMessageHandler handler, IntelligenceSdkLimits? limits = null) =>
        new(new IntelligenceClientOptions(new Uri("https://registry.test"), "secret-token", "project-a", _cacheRoot, limits), handler);

    private IntelligenceClient GoldenClient(HttpMessageHandler handler, JsonObject golden) =>
        new(new IntelligenceClientOptions(
            new Uri(golden["identity"]!["baseUrl"]!.GetValue<string>()),
            "secret-token",
            golden["identity"]!["projectNamespace"]!.GetValue<string>(),
            _cacheRoot), handler);

    private static JsonObject GoldenRegistryFixture()
    {
        var path = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "../../../../../packages/intelligence/conformance/registry-sdk-v1.json"));
        return JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    }

    private static HttpResponseMessage Json(JsonNode value, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(value.ToJsonString(), Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Bytes(byte[] value) =>
        new(HttpStatusCode.OK) { Content = new ByteArrayContent(value) };

    private static Fixture CreateFixture(
        IEnumerable<(string Path, byte[] Bytes)>? files = null,
        IReadOnlyList<string>? manifestOrder = null,
        bool empty = false,
        bool revoked = false,
        Action<JsonObject>? projectionMutation = null)
    {
        var entries = (files ?? new[] { ("safe/SKILL.md", Encoding.UTF8.GetBytes("# Skill\n")) }).ToArray();
        var archive = Zip(entries);
        var relative = entries.Select(value => value.Path.Contains('/') ? value.Path[(value.Path.IndexOf('/') + 1)..] : value.Path).ToArray();
        var byPath = entries.Zip(relative).ToDictionary(value => value.Second, value => value.First.Bytes, StringComparer.Ordinal);
        var order = manifestOrder ?? relative;
        var manifest = new JsonObject
        {
            ["manifestVersion"] = 1,
            ["agentSkillsProfile"] = "agentskills:v1",
            ["files"] = new JsonArray(order.Select(path => (JsonNode)new JsonObject
            {
                ["path"] = path,
                ["role"] = path == "SKILL.md" ? "instructions" : "resource",
                ["mediaType"] = "text/markdown",
                ["byteLength"] = byPath[path].Length,
                ["rawSha256"] = Sha(byPath[path]),
            }).ToArray()),
            ["bundleSha256"] = Sha(archive),
            ["bundleByteLength"] = archive.Length,
            ["provenance"] = new JsonObject(),
        };
        manifest["manifestSha256"] = Sha(Encoding.UTF8.GetBytes(Canonical(manifest)));
        var entry = new JsonObject
        {
            ["skillId"] = SkillId,
            ["versionId"] = VersionId,
            ["position"] = 0,
            ["name"] = "Safe skill",
            ["description"] = null,
            ["bundleLocator"] = new JsonObject
            {
                ["schemaVersion"] = 1,
                ["backendId"] = "primary",
                ["provider"] = "awsS3",
                ["resource"] = "skill-bundles",
                ["key"] = "objects/safe.zip",
                ["providerVersion"] = null,
                ["etag"] = null,
                ["applicationSha256"] = Sha(archive),
                ["providerChecksum"] = null,
                ["byteLength"] = archive.Length,
                ["contentType"] = "application/zip",
            },
            ["bundleSha256"] = Sha(archive),
            ["manifestSha256"] = manifest["manifestSha256"]!.GetValue<string>(),
            ["bundleByteLength"] = archive.Length,
            ["approvalMethod"] = "manual",
            ["manifest"] = manifest,
            ["futureEntryField"] = "preserved",
        };
        var projection = new JsonObject
        {
            ["schemaVersion"] = 1,
            ["learningContainerId"] = ContainerId,
            ["registryRevision"] = "revision-1",
            ["skillSetHash"] = Sha(empty ? Encoding.UTF8.GetBytes("empty") : archive),
            ["etag"] = "\"registry-1\"",
            ["entries"] = empty ? new JsonArray() : new JsonArray(entry),
            ["publishedAt"] = "2026-07-16T18:00:00.000Z",
            ["revoked"] = revoked,
            ["futureProjectionField"] = new JsonObject { ["preserved"] = true },
        };
        projectionMutation?.Invoke(projection);
        return new Fixture(archive, projection);
    }

    private static byte[] Zip(IEnumerable<(string Path, byte[] Bytes)> files)
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var file in files)
            {
                var entry = archive.CreateEntry(file.Path, CompressionLevel.NoCompression);
                using var stream = entry.Open();
                stream.Write(file.Bytes);
            }
        return output.ToArray();
    }

    private static string Canonical(JsonNode node)
    {
        if (node is JsonObject obj)
            return "{" + string.Join(",", obj.Where(pair => pair.Key != "manifestSha256").OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => JsonSerializer.Serialize(pair.Key) + ":" + Canonical(pair.Value!))) + "}";
        if (node is JsonArray array) return "[" + string.Join(",", array.Select(item => Canonical(item!))) + "]";
        return node.ToJsonString();
    }

    private static string Sha(byte[] value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

    private sealed record Fixture(byte[] Archive, JsonObject Projection);

    private sealed class QueueHandler(params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses = new(responses);
        public List<HttpRequestMessage> Requests { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(Clone(request));
            return Task.FromResult(_responses.Dequeue());
        }
    }

    private sealed class RepeatingHandler(Fixture fixture) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/skills", StringComparison.Ordinal) ? Json(fixture.Projection) : Bytes(fixture.Archive));
    }

    private sealed class ThrowingHandler(Exception exception) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromException<HttpResponseMessage>(exception);
    }

    private sealed class CancellingHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException("Unreachable");
        }
    }

    private static HttpRequestMessage Clone(HttpRequestMessage request)
    {
        var clone = new HttpRequestMessage(request.Method, request.RequestUri);
        foreach (var header in request.Headers) clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        return clone;
    }
}
