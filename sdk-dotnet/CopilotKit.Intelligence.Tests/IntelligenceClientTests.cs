using System.IO.Compression;
using System.Net;
using System.Reflection;
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
    private static readonly string[] MultiSkillIds =
    [
        SkillId,
        "88888888-8888-4888-8888-888888888888",
        "77777777-7777-4777-8777-777777777777",
        "66666666-6666-4666-8666-666666666666",
    ];
    private static readonly string[] MultiVersionIds =
    [
        VersionId,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ];
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

        // Both scenarios are driven from errors.*.invalidatesCache rather than a
        // hardcoded expectation, so the shared fixture field is what decides.
        foreach (var key in new[] { "canonicalConflict", "canonicalDenial" })
        {
            var scenario = golden["errors"]![key]!.AsObject();
            var invalidatesCache = Assert.IsType<bool>(scenario["invalidatesCache"]!.GetValue<bool>());
            using var client = GoldenClient(new QueueHandler(Json(
                scenario["body"]!, (HttpStatusCode)scenario["status"]!.GetValue<int>())), golden);

            var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));
            Assert.Equal(scenario["body"]!["error"]!["code"]!.GetValue<string>(), error.Code);
            Assert.Equal(scenario["body"]!["requestId"]!.GetValue<string>(), error.RequestId);

            if (invalidatesCache)
            {
                var cacheError = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetCachedAsync(ContainerId));
                Assert.Equal(IntelligenceErrorCodes.CacheCorrupt, cacheError.Code);
            }
            else
            {
                Assert.Equal(
                    golden["expectations"]!["explicitCacheFreshness"]!.GetValue<string>(),
                    (await client.GetCachedAsync(ContainerId)).Freshness.ToString().ToLowerInvariant());
            }
        }
    }

    [Fact]
    public async Task GoldenSecondUnconditional304UsesTheSharedCanonicalCode()
    {
        var golden = GoldenRegistryFixture();
        var archive = Convert.FromBase64String(golden["bundle"]!["base64"]!.GetValue<string>());
        var containerId = golden["identity"]!["learningContainerId"]!.GetValue<string>();
        using (var online = GoldenClient(new QueueHandler(Json(golden["projection"]!), Bytes(archive)), golden))
        {
            var installed = await online.GetAsync(containerId);
            Directory.Delete(installed.Directory, recursive: true);
        }

        var handler = new QueueHandler(
            new HttpResponseMessage(HttpStatusCode.NotModified),
            new HttpResponseMessage(HttpStatusCode.NotModified));
        using var client = GoldenClient(handler, golden);

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(containerId));

        Assert.Equal(
            golden["expectations"]!["secondUnconditional304Code"]!.GetValue<string>(),
            error.Code);
        Assert.Equal("internal", error.Category);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Empty(handler.Requests[1].Headers.IfNoneMatch);
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
    public void EmbeddedErrorAllowlistsEqualCanonicalConformanceEnums()
    {
        var vocabulary = CanonicalErrorVocabulary();

        Assert.Equal(vocabulary.Codes.ToHashSet(StringComparer.Ordinal), EmbeddedAllowlist("CanonicalErrorCodes"));
        Assert.Equal(vocabulary.Categories.ToHashSet(StringComparer.Ordinal), EmbeddedAllowlist("CanonicalErrorCategories"));
    }

    [Fact]
    public async Task EveryCanonicalErrorCodeAndCategoryRoundTrips()
    {
        var vocabulary = CanonicalErrorVocabulary();
        Directory.CreateDirectory(Path.Combine(
            _cacheRoot,
            "v1",
            Sha(Encoding.UTF8.GetBytes("project-a")),
            ContainerId));

        foreach (var code in vocabulary.Codes)
        {
            using var client = Client(new QueueHandler(CanonicalError(code, "dependency")));
            var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));
            Assert.Equal(code, error.Code);
            Assert.Equal("dependency", error.Category);
        }

        foreach (var category in vocabulary.Categories)
        {
            using var client = Client(new QueueHandler(CanonicalError("LEARNING_JOB_LAUNCH_FAILED", category)));
            var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));
            Assert.Equal("LEARNING_JOB_LAUNCH_FAILED", error.Code);
            Assert.Equal(category, error.Category);
        }
    }

    [Theory]
    [InlineData("LEARNING_CANDIDATE_STALE_PARENT")]
    [InlineData("LEARNING_CANDIDATE_SUBJECT_MISMATCH")]
    [InlineData("LEARNING_CANDIDATE_GATES_INCOMPLETE")]
    public async Task ObsoleteErrorAliasesFailClosedAsNoncanonical(string code)
    {
        using var client = Client(new QueueHandler(CanonicalError(code, "conflict")));

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));

        Assert.Equal(IntelligenceErrorCodes.RegistryUnrecoverable, error.Code);
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
    public async Task GetAsync_InstallsOrdersAndNamesEverySkillInAMultiSkillProjection()
    {
        var fixture = CreateMultiFixture(count: 3);
        var responses = new List<HttpResponseMessage> { Json(fixture.Projection) };
        responses.AddRange(fixture.Archives.Select(Bytes));
        var handler = new QueueHandler([.. responses]);
        using var client = Client(handler);

        var installed = await client.GetAsync(ContainerId);

        Assert.Equal(4, handler.Requests.Count);
        Assert.Equal(3, installed.Skills.Count);
        Assert.Equal([0, 1, 2], installed.Skills.Select(skill => skill.Position));
        Assert.Equal(MultiSkillIds.Take(3), installed.Skills.Select(skill => skill.SkillId));
        Assert.Equal(MultiVersionIds.Take(3), installed.Skills.Select(skill => skill.VersionId));
        for (var index = 0; index < installed.Skills.Count; index++)
        {
            Assert.Equal(
                Path.Combine(installed.Directory, "skills", $"{index:D6}-{MultiSkillIds[index]}", $"skill-{index}"),
                installed.Skills[index].Directory);
            Assert.Equal(
                $"# Skill {index}\n",
                await File.ReadAllTextAsync(Path.Combine(installed.Skills[index].Directory, "SKILL.md")));
            Assert.Equal(
                $"reference {index}\n",
                await File.ReadAllTextAsync(Path.Combine(installed.Skills[index].Directory, "reference.md")));
        }
    }

    [Fact]
    public async Task GetAsync_KeepsMultiSkillIndexAlignmentAcrossAVerified304()
    {
        var fixture = CreateMultiFixture(count: 3);
        var responses = new List<HttpResponseMessage> { Json(fixture.Projection) };
        responses.AddRange(fixture.Archives.Select(Bytes));
        InstalledSkillSet first;
        using (var initial = Client(new QueueHandler([.. responses])))
            first = await initial.GetAsync(ContainerId);

        using var conditional = Client(new QueueHandler(new HttpResponseMessage(HttpStatusCode.NotModified)));
        var revalidated = await conditional.GetAsync(ContainerId);

        Assert.Equal(CacheFreshness.Fresh, revalidated.Freshness);
        Assert.Equal(first.Skills, revalidated.Skills);
        Assert.Equal(MultiSkillIds.Take(3), revalidated.Projection.Entries.Select(entry => entry.SkillId));
    }

    [Fact]
    public async Task GetAsync_RepairsOneCorruptSkillOfAMultiSkillSetFromFreshBytes()
    {
        var fixture = CreateMultiFixture(count: 3);
        var responses = new List<HttpResponseMessage> { Json(fixture.Projection) };
        responses.AddRange(fixture.Archives.Select(Bytes));
        using (var initial = Client(new QueueHandler([.. responses])))
        {
            var installed = await initial.GetAsync(ContainerId);
            await File.WriteAllTextAsync(
                Path.Combine(installed.Skills[2].Directory, "reference.md"), "corrupt");
        }

        var repairing = new List<HttpResponseMessage>
        {
            new(HttpStatusCode.NotModified),
            Json(fixture.Projection),
        };
        repairing.AddRange(fixture.Archives.Select(Bytes));
        var handler = new QueueHandler([.. repairing]);
        using var client = Client(handler);
        var repaired = await client.GetAsync(ContainerId);

        Assert.Equal(5, handler.Requests.Count);
        Assert.Empty(handler.Requests[1].Headers.IfNoneMatch);
        Assert.Equal(
            "reference 2\n",
            await File.ReadAllTextAsync(Path.Combine(repaired.Skills[2].Directory, "reference.md")));
    }

    [Fact]
    public async Task GetAsync_RejectsMultiSkillProjectionOrderingAndIdentityViolations()
    {
        var invalid = new (string Name, JsonObject Projection)[]
        {
            ("duplicate skill ids", CreateMultiFixture(
                count: 3,
                skillIds: [MultiSkillIds[0], MultiSkillIds[1], MultiSkillIds[0]]).Projection),
            ("position gaps", CreateMultiFixture(count: 3, positions: [0, 2, 3]).Projection),
            ("out-of-order positions", CreateMultiFixture(count: 3, positions: [0, 2, 1]).Projection),
            ("a repeated position", CreateMultiFixture(count: 3, positions: [0, 1, 1]).Projection),
            ("a non-zero first position", CreateMultiFixture(count: 3, positions: [1, 2, 3]).Projection),
        };

        foreach (var (name, projection) in invalid)
        {
            using var client = Client(new QueueHandler(Json(projection)));
            var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));
            Assert.Equal(IntelligenceErrorCodes.CacheCorrupt, error.Code);
            Assert.False(string.IsNullOrEmpty(name));
        }
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

    /// <summary>
    /// ToUpperInvariant applies simple case mapping, so it neither expands
    /// U+00DF to "ss" nor folds U+0130 nor expands the U+FB01 ligature. The
    /// conformance corpus declares every one of these path pairs invalid, and
    /// the SDK must reject them with full Unicode Default Case Folding.
    /// </summary>
    [Theory]
    [InlineData("references/Straße.txt", "references/STRASSE.txt")]
    [InlineData("references/İ.txt", "references/i̇.txt")]
    [InlineData("ﬁle.md", "file.md")]
    [InlineData("SKILL2.md", "skill2.md")]
    public async Task GetAsync_RejectsUnicodeDefaultCaseFoldPathCollisions(string left, string right)
    {
        var files = new[]
        {
            ("safe/SKILL.md", Encoding.UTF8.GetBytes("# Skill\n")),
            ($"safe/{left}", Encoding.UTF8.GetBytes("a")),
            ($"safe/{right}", Encoding.UTF8.GetBytes("b")),
        };

        // The manifest is checked before any bundle byte is fetched, so a
        // colliding manifest must be refused without touching the archive.
        var manifestFixture = CreateFixture(files, manifestOrder: [right, left, "SKILL.md"]);
        using (var manifestClient = Client(new QueueHandler(Json(manifestFixture.Projection), Bytes(manifestFixture.Archive))))
        {
            var manifestError = await Assert.ThrowsAsync<IntelligenceSdkException>(() => manifestClient.GetAsync(ContainerId));
            Assert.Equal(IntelligenceErrorCodes.BlobIntegrityFailure, manifestError.Code);
            Assert.Equal("Artifact manifest path collision", manifestError.Message);
        }

        // With the manifest listing only SKILL.md the ZIP-level collision check
        // is the one that has to fire, before any file is written to disk.
        var archiveFixture = CreateFixture(files, manifestOrder: ["SKILL.md"]);
        using var archiveClient = Client(new QueueHandler(Json(archiveFixture.Projection), Bytes(archiveFixture.Archive)));
        var archiveError = await Assert.ThrowsAsync<IntelligenceSdkException>(() => archiveClient.GetAsync(ContainerId));
        Assert.Equal(IntelligenceErrorCodes.BlobIntegrityFailure, archiveError.Code);
        Assert.Equal("ZIP path collision detected", archiveError.Message);
    }

    /// <summary>
    /// A cold cache has no container directory, so invalidating the pointer with
    /// a bare File.Delete throws DirectoryNotFoundException and escapes before
    /// the canonical error envelope is parsed into a typed failure.
    /// </summary>
    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Gone)]
    public async Task GetAsync_OnColdCacheSurfacesTheTypedErrorFor4xxStatuses(HttpStatusCode status)
    {
        using var client = Client(new QueueHandler(Json(new JsonObject
        {
            ["error"] = new JsonObject
            {
                ["code"] = "LEARNING_CONTAINER_PROJECT_MISMATCH",
                ["message"] = "Canonical Learning Platform error.",
                ["category"] = "permission",
                ["retryable"] = false,
            },
            ["requestId"] = "request-cold",
            ["traceId"] = "trace-cold",
        }, status)));

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetAsync(ContainerId));

        Assert.Equal("LEARNING_CONTAINER_PROJECT_MISMATCH", error.Code);
        Assert.Equal("permission", error.Category);
        Assert.Equal("request-cold", error.RequestId);
        Assert.Equal((int)status, error.Status);
    }

    /// <summary>
    /// A pointer whose projection is missing or null must fail as a typed SDK
    /// error so that GetAsync's recovery handler still runs the mandatory
    /// unconditional refetch instead of escaping with a NullReferenceException.
    /// </summary>
    [Theory]
    [InlineData("{\"schemaVersion\":1,\"skillSetHash\":\"$HASH\",\"etag\":\"\\\"registry-1\\\"\"}")]
    [InlineData("{\"schemaVersion\":1,\"skillSetHash\":\"$HASH\",\"etag\":\"\\\"registry-1\\\"\",\"projection\":null}")]
    [InlineData("{\"schemaVersion\":1,\"skillSetHash\":\"$HASH\",\"eTag\":\"\\\"registry-1\\\"\"}")]
    public async Task CorruptPointerFailsTypedAndStillForcesTheUnconditionalRefetch(string pointerJson)
    {
        var fixture = CreateFixture();
        var container = Path.Combine(_cacheRoot, "v1", Sha(Encoding.UTF8.GetBytes("project-a")), ContainerId);
        Directory.CreateDirectory(container);
        await File.WriteAllTextAsync(
            Path.Combine(container, ".copilotkit-current.json"),
            pointerJson.Replace("$HASH", new string('b', 64), StringComparison.Ordinal));
        using var client = Client(new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive)));

        var error = await Assert.ThrowsAsync<IntelligenceSdkException>(() => client.GetCachedAsync(ContainerId));
        Assert.Equal(IntelligenceErrorCodes.CacheCorrupt, error.Code);

        var recovered = await client.GetAsync(ContainerId);
        Assert.Equal(CacheFreshness.Fresh, recovered.Freshness);
        Assert.Single(recovered.Skills);
    }

    /// <summary>
    /// The pointer file name and layout are shared with the TypeScript and
    /// Python SDKs, so the ETag member must be written as the canonical
    /// lowercase "etag" while a legacy "eTag" file stays readable.
    /// </summary>
    [Fact]
    public async Task PointerUsesTheCanonicalLowercaseEtagAndStillReadsALegacyOne()
    {
        var fixture = CreateFixture();
        using (var initial = Client(new QueueHandler(Json(fixture.Projection), Bytes(fixture.Archive))))
            await initial.GetAsync(ContainerId);
        var pointerPath = Path.Combine(
            _cacheRoot, "v1", Sha(Encoding.UTF8.GetBytes("project-a")), ContainerId, ".copilotkit-current.json");
        var pointer = JsonNode.Parse(await File.ReadAllTextAsync(pointerPath))!.AsObject();

        Assert.Contains("etag", pointer.Select(pair => pair.Key), StringComparer.Ordinal);
        Assert.DoesNotContain("eTag", pointer.Select(pair => pair.Key), StringComparer.Ordinal);

        var etag = pointer["etag"]!.GetValue<string>();
        pointer.Remove("etag");
        pointer["eTag"] = etag;
        await File.WriteAllTextAsync(pointerPath, pointer.ToJsonString());
        using var legacy = Client(new QueueHandler(new HttpResponseMessage(HttpStatusCode.NotModified)));

        var cached = await legacy.GetCachedAsync(ContainerId);

        Assert.Equal(CacheFreshness.Cached, cached.Freshness);
        Assert.Single(cached.Skills);
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

    private static (string[] Codes, string[] Categories) CanonicalErrorVocabulary()
    {
        var path = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "../../../../../packages/intelligence/conformance/learning-platform-v1.json"));
        var corpus = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        var properties = corpus["schemas"]!["LearningPlatformErrorResponseV1"]!["properties"]!["error"]!["properties"]!;
        return (
            properties["code"]!["enum"]!.AsArray().Select(value => value!.GetValue<string>()).ToArray(),
            properties["category"]!["enum"]!.AsArray().Select(value => value!.GetValue<string>()).ToArray());
    }

    private static HashSet<string> EmbeddedAllowlist(string fieldName)
    {
        var field = typeof(IntelligenceClient).GetField(fieldName, BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(field);
        return Assert.IsType<HashSet<string>>(field.GetValue(null));
    }

    private static HttpResponseMessage CanonicalError(string code, string category) =>
        Json(new JsonObject
        {
            ["error"] = new JsonObject
            {
                ["code"] = code,
                ["message"] = "Canonical Learning Platform error.",
                ["category"] = category,
                ["retryable"] = true,
            },
            ["requestId"] = "request-canonical",
            ["traceId"] = "trace-canonical",
        }, HttpStatusCode.InternalServerError);

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

    /// <summary>
    /// Builds a projection carrying more than one ordered skill, each with its own
    /// root directory, bundle bytes, and manifest. Single-entry fixtures cannot
    /// reach the per-entry install loop's second iteration, the duplicate-skillId
    /// branch, non-zero <c>{Position:D6}</c> directory names, or the index
    /// alignment in ValidateProjection and AssertProjectionMatchesCachedSkills.
    /// </summary>
    private static MultiFixture CreateMultiFixture(
        int count = 3,
        IReadOnlyList<int>? positions = null,
        IReadOnlyList<string>? skillIds = null)
    {
        var ids = skillIds ?? MultiSkillIds.Take(count).ToArray();
        var order = positions ?? Enumerable.Range(0, ids.Count).ToArray();
        var archives = new List<byte[]>();
        var entries = new JsonArray();
        for (var index = 0; index < ids.Count; index++)
        {
            var root = $"skill-{index}";
            var skill = Encoding.UTF8.GetBytes($"# Skill {index}\n");
            var reference = Encoding.UTF8.GetBytes($"reference {index}\n");
            var archive = Zip([($"{root}/SKILL.md", skill), ($"{root}/reference.md", reference)]);
            archives.Add(archive);
            var manifest = new JsonObject
            {
                ["manifestVersion"] = 1,
                ["agentSkillsProfile"] = "agentskills:v1",
                ["files"] = new JsonArray(
                    new JsonObject
                    {
                        ["path"] = "SKILL.md",
                        ["role"] = "instructions",
                        ["mediaType"] = "text/markdown",
                        ["byteLength"] = skill.Length,
                        ["rawSha256"] = Sha(skill),
                    },
                    new JsonObject
                    {
                        ["path"] = "reference.md",
                        ["role"] = "resource",
                        ["mediaType"] = "text/markdown",
                        ["byteLength"] = reference.Length,
                        ["rawSha256"] = Sha(reference),
                    }),
                ["bundleSha256"] = Sha(archive),
                ["bundleByteLength"] = archive.Length,
                ["provenance"] = new JsonObject(),
            };
            manifest["manifestSha256"] = Sha(Encoding.UTF8.GetBytes(Canonical(manifest)));
            entries.Add(new JsonObject
            {
                ["skillId"] = ids[index],
                ["versionId"] = MultiVersionIds[index],
                ["position"] = order[index],
                ["name"] = $"Skill {index}",
                ["description"] = null,
                ["bundleLocator"] = new JsonObject
                {
                    ["schemaVersion"] = 1,
                    ["backendId"] = "primary",
                    ["provider"] = "awsS3",
                    ["resource"] = "skill-bundles",
                    ["key"] = $"objects/skill-{index}.zip",
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
            });
        }
        var projection = new JsonObject
        {
            ["schemaVersion"] = 1,
            ["learningContainerId"] = ContainerId,
            ["registryRevision"] = "revision-1",
            ["skillSetHash"] = Sha(Encoding.UTF8.GetBytes(string.Join(":", archives.Select(Sha)))),
            ["etag"] = "\"registry-1\"",
            ["entries"] = entries,
            ["publishedAt"] = "2026-07-16T18:00:00.000Z",
            ["revoked"] = false,
        };
        return new MultiFixture([.. archives], projection);
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

    private sealed record MultiFixture(byte[][] Archives, JsonObject Projection);

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
