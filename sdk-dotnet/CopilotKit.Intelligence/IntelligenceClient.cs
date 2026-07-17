using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace CopilotKit.Intelligence;

public sealed class IntelligenceClient : IDisposable
{
    private const string MetadataFile = ".copilotkit-skill-set.json";
    private const string PointerFile = ".copilotkit-current.json";
    private static readonly Regex CanonicalUuid = new(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly HashSet<string> CanonicalErrorCodes =
    [
        "LEARNING_CONTAINER_NOT_FOUND",
        "LEARNING_CONTAINER_ARCHIVED",
        "LEARNING_CONTAINER_PROJECT_MISMATCH",
        "LEARNING_CONTAINER_CONFIG_CONFLICT",
        "LEARNING_CONTAINER_ASSIGNMENT_MISMATCH",
        "LEARNING_CONTAINER_ASSIGNMENT_CONFLICT",
        "LEARNING_RUN_ACTIVE_CONFLICT",
        "LEARNING_RUN_IDEMPOTENCY_CONFLICT",
        "LEARNING_ATTEMPT_FENCE_REJECTED",
        "LEARNING_SNAPSHOT_INVARIANT_VIOLATION",
        "LEARNING_CANDIDATE_STALE_PARENT",
        "LEARNING_CANDIDATE_SUBJECT_MISMATCH",
        "LEARNING_CANDIDATE_GATES_INCOMPLETE",
        "LEARNING_REGISTRY_CONFLICT",
        "LEARNING_REGISTRY_UNRECOVERABLE",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
        "LEARNING_SDK_CACHE_CORRUPT",
    ];
    private static readonly HashSet<string> CanonicalErrorCategories =
    [
        "validation", "auth", "permission", "not_found", "conflict",
        "rate_limit", "internal", "dependency",
    ];
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private readonly IntelligenceClientOptions _options;
    private readonly HttpClient _httpClient;
    private readonly ResolvedLimits _limits;

    public IntelligenceClient(IntelligenceClientOptions options, HttpMessageHandler? handler = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (!options.BaseUrl.IsAbsoluteUri || string.IsNullOrEmpty(options.AccessToken) ||
            string.IsNullOrEmpty(options.ProjectNamespace) || string.IsNullOrEmpty(options.CacheRoot))
            throw Error("BaseUrl, AccessToken, ProjectNamespace, and CacheRoot are required", IntelligenceErrorCode.RegistryUnrecoverable, "validation");

        _options = options;
        _limits = ResolvedLimits.From(options.Limits);
        _httpClient = handler is null ? new HttpClient() : new HttpClient(handler, disposeHandler: true);
    }

    public async Task<InstalledSkillSet> GetAsync(string learningContainerId, CancellationToken cancellationToken = default)
    {
        ValidateContainerId(learningContainerId);
        var paths = Paths(learningContainerId);
        CachePointer? pointer = null;
        try
        {
            pointer = await ReadPointerAsync(paths.Pointer, learningContainerId, cancellationToken).ConfigureAwait(false);
        }
        catch (IntelligenceSdkException)
        {
            // A missing or corrupt pointer is recoverable only with an unconditional registry read.
        }

        using var initial = await RequestAsync(ProjectionUrl(learningContainerId), pointer?.ETag, cancellationToken).ConfigureAwait(false);
        HttpResponseMessage response = initial;
        HttpResponseMessage? refetch = null;
        if (response.StatusCode == HttpStatusCode.NotModified)
        {
            try
            {
                return await CurrentAsync(learningContainerId, CacheFreshness.Fresh, cancellationToken).ConfigureAwait(false);
            }
            catch (IntelligenceSdkException)
            {
                refetch = await RequestAsync(ProjectionUrl(learningContainerId), null, cancellationToken).ConfigureAwait(false);
                response = refetch;
                if (response.StatusCode == HttpStatusCode.NotModified)
                    throw Error("Unconditional registry refetch returned 304");
            }
        }

        try
        {
            if (response.StatusCode != HttpStatusCode.OK)
                await ThrowResponseAsync(response, paths.Pointer, cancellationToken).ConfigureAwait(false);

            var projection = await DeserializeResponseAsync<SkillSetProjection>(response, "Registry projection is not valid JSON", cancellationToken).ConfigureAwait(false);
            ValidateProjection(projection, learningContainerId);
            var directory = Path.Combine(paths.Sets, projection.SkillSetHash);
            CacheMetadata metadata;
            try
            {
                metadata = await VerifySetAsync(directory, paths.NamespaceHash, learningContainerId, projection.SkillSetHash, cancellationToken).ConfigureAwait(false);
                AssertProjectionMatchesCachedSkills(projection, metadata);
            }
            catch (IntelligenceSdkException)
            {
                metadata = await InstallAsync(paths, projection, cancellationToken).ConfigureAwait(false);
            }

            await WriteJsonAtomicAsync(paths.Pointer, new CachePointer(1, projection.SkillSetHash, projection.ETag, projection), cancellationToken).ConfigureAwait(false);
            return Result(directory, metadata, projection, CacheFreshness.Fresh);
        }
        finally
        {
            refetch?.Dispose();
        }
    }

    public async Task<InstalledSkillSet> GetCachedAsync(string learningContainerId, CancellationToken cancellationToken = default)
    {
        ValidateContainerId(learningContainerId);
        return await CurrentAsync(learningContainerId, CacheFreshness.Cached, cancellationToken).ConfigureAwait(false);
    }

    public void Dispose() => _httpClient.Dispose();

    private async Task<InstalledSkillSet> CurrentAsync(string learningContainerId, CacheFreshness freshness, CancellationToken cancellationToken)
    {
        var paths = Paths(learningContainerId);
        var pointer = await ReadPointerAsync(paths.Pointer, learningContainerId, cancellationToken).ConfigureAwait(false);
        var directory = Path.Combine(paths.Sets, pointer.SkillSetHash);
        var metadata = await VerifySetAsync(directory, paths.NamespaceHash, learningContainerId, pointer.SkillSetHash, cancellationToken).ConfigureAwait(false);
        AssertProjectionMatchesCachedSkills(pointer.Projection, metadata);
        return Result(directory, metadata, pointer.Projection, freshness);
    }

    private async Task<CacheMetadata> InstallAsync(CachePaths paths, SkillSetProjection projection, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(paths.Sets);
        var staging = Path.Combine(paths.Sets, $".{projection.SkillSetHash}.staging-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);
        try
        {
            var cachedSkills = new List<CachedSkillMetadata>();
            foreach (var entry in projection.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var manifest = ValidateManifest(entry);
                using var response = await RequestAsync(BundleUrl(projection.LearningContainerId, entry), null, cancellationToken).ConfigureAwait(false);
                if (response.StatusCode != HttpStatusCode.OK)
                    await ThrowResponseAsync(response, paths.Pointer, cancellationToken).ConfigureAwait(false);
                var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
                if (bytes.LongLength != entry.BundleByteLength || bytes.LongLength != entry.BundleLocator.ByteLength ||
                    Sha256(bytes) != entry.BundleSha256 || Sha256(bytes) != entry.BundleLocator.ApplicationSha256)
                    throw Error("Downloaded bundle integrity mismatch", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
                if (bytes.LongLength > _limits.MaxBundleBytes)
                    throw Error("Bundle exceeds configured byte limit", IntelligenceErrorCode.BlobIntegrityFailure, "validation");

                var extracted = await ReadArchiveAsync(bytes, cancellationToken).ConfigureAwait(false);
                var roots = extracted.Select(file => file.ArchivePath.Split('/')[0]).Distinct(StringComparer.Ordinal).ToArray();
                if (roots.Length != 1 || extracted.Any(file => !file.ArchivePath.Contains('/', StringComparison.Ordinal)))
                    throw Error("Skill ZIP must contain exactly one root directory", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
                var root = roots[0];
                ValidateRelativePath(root);
                var relativePaths = extracted.Select(file => file.ArchivePath[(root.Length + 1)..]).ToArray();
                if (!relativePaths.SequenceEqual(manifest.Files.Select(file => file.Path), StringComparer.Ordinal))
                    throw Error("ZIP files do not exactly match manifest order", IntelligenceErrorCode.BlobIntegrityFailure, "validation");

                var destination = Path.Combine(staging, "skills", $"{entry.Position:D6}-{entry.SkillId}", root);
                for (var index = 0; index < extracted.Count; index++)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var archiveFile = extracted[index];
                    var manifestFile = manifest.Files[index];
                    if (archiveFile.Bytes.LongLength != manifestFile.ByteLength || Sha256(archiveFile.Bytes) != manifestFile.RawSha256)
                        throw Error($"Bundle file failed integrity verification: {manifestFile.Path}", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
                    var output = Path.Combine(destination, manifestFile.Path.Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(output)!);
                    await WriteNewFileAsync(output, archiveFile.Bytes, cancellationToken).ConfigureAwait(false);
                }
                cachedSkills.Add(new CachedSkillMetadata(entry.SkillId, entry.VersionId, entry.Position, root, manifest));
            }

            var metadata = new CacheMetadata(1, paths.NamespaceHash, projection, cachedSkills);
            await WriteNewFileAsync(Path.Combine(staging, MetadataFile), JsonSerializer.SerializeToUtf8Bytes(metadata, JsonOptions), cancellationToken).ConfigureAwait(false);
            await VerifySetAsync(staging, paths.NamespaceHash, projection.LearningContainerId, projection.SkillSetHash, cancellationToken).ConfigureAwait(false);
            var target = Path.Combine(paths.Sets, projection.SkillSetHash);
            try
            {
                Directory.Move(staging, target);
            }
            catch (IOException)
            {
                try
                {
                    var winner = await VerifySetAsync(target, paths.NamespaceHash, projection.LearningContainerId, projection.SkillSetHash, cancellationToken).ConfigureAwait(false);
                    AssertProjectionMatchesCachedSkills(projection, winner);
                    return winner;
                }
                catch (IntelligenceSdkException)
                {
                    var quarantine = $"{target}.corrupt-{Guid.NewGuid():N}";
                    try
                    {
                        Directory.Move(target, quarantine);
                        Directory.Move(staging, target);
                    }
                    catch (IOException)
                    {
                        var winner = await VerifySetAsync(target, paths.NamespaceHash, projection.LearningContainerId, projection.SkillSetHash, cancellationToken).ConfigureAwait(false);
                        DeleteDirectory(quarantine);
                        AssertProjectionMatchesCachedSkills(projection, winner);
                        return winner;
                    }
                    DeleteDirectory(quarantine);
                }
            }
            return await VerifySetAsync(target, paths.NamespaceHash, projection.LearningContainerId, projection.SkillSetHash, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            DeleteDirectory(staging);
        }
    }

    private async Task<List<ArchiveFile>> ReadArchiveAsync(byte[] bytes, CancellationToken cancellationToken)
    {
        var files = new List<ArchiveFile>();
        var collisions = new HashSet<string>(StringComparer.Ordinal);
        long total = 0;
        try
        {
            using var stream = new MemoryStream(bytes, writable: false);
            using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: false, Encoding.UTF8);
            if (archive.Entries.Count > _limits.MaxFiles + 1)
                throw Error("Bundle contains too many entries", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
            foreach (var entry in archive.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var path = entry.FullName;
                var isDirectory = path.EndsWith("/", StringComparison.Ordinal);
                var checkedPath = isDirectory ? path[..^1] : path;
                ValidateRelativePath(checkedPath);
                var unixType = (entry.ExternalAttributes >> 16) & 0xF000;
                if (unixType == 0xA000 || (!isDirectory && unixType != 0 && unixType != 0x8000))
                    throw Error("Links and special files are forbidden", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
                var collision = checkedPath.Normalize(NormalizationForm.FormC).ToUpperInvariant();
                if (!collisions.Add(collision))
                    throw Error("ZIP path collision detected", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
                if (isDirectory) continue;
                if (entry.Length > _limits.MaxFileBytes)
                    throw Error("Bundle file exceeds configured byte limit", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
                total = checked(total + entry.Length);
                if (total > _limits.MaxUncompressedBytes || files.Count >= _limits.MaxFiles)
                    throw Error("Bundle expansion bounds exceeded", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
                await using var source = entry.Open();
                using var output = new MemoryStream((int)Math.Min(entry.Length, int.MaxValue));
                await source.CopyToAsync(output, cancellationToken).ConfigureAwait(false);
                if (output.Length != entry.Length)
                    throw Error("ZIP entry length mismatch", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
                files.Add(new ArchiveFile(path, output.ToArray()));
            }
        }
        catch (IntelligenceSdkException)
        {
            throw;
        }
        catch (Exception error) when (error is InvalidDataException or IOException or OverflowException)
        {
            throw Error("Bundle is not a valid bounded ZIP archive", IntelligenceErrorCode.BlobIntegrityFailure, "validation", error);
        }
        return files;
    }

    private async Task<CacheMetadata> VerifySetAsync(string directory, string namespaceHash, string learningContainerId, string? expectedHash, CancellationToken cancellationToken)
    {
        try
        {
            var metadata = await ReadJsonAsync<CacheMetadata>(Path.Combine(directory, MetadataFile), cancellationToken).ConfigureAwait(false);
            if (metadata.SchemaVersion != 1 || metadata.ProjectNamespaceSha256 != namespaceHash)
                throw Error("Cache metadata identity mismatch");
            ValidateProjection(metadata.Projection, learningContainerId);
            if (expectedHash is not null && metadata.Projection.SkillSetHash != expectedHash)
                throw Error("Cache set hash mismatch");
            if (metadata.Skills.Count != metadata.Projection.Entries.Count)
                throw Error("Cache skill count mismatch");

            var expectedFiles = new HashSet<string>(StringComparer.Ordinal) { MetadataFile };
            for (var index = 0; index < metadata.Skills.Count; index++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var skill = metadata.Skills[index];
                var entry = metadata.Projection.Entries[index];
                if (skill.SkillId != entry.SkillId || skill.VersionId != entry.VersionId || skill.Position != entry.Position)
                    throw Error("Cache skill metadata mismatch");
                ValidateRelativePath(skill.RootDirectory);
                ValidateManifestObject(skill.Manifest);
                if (skill.Manifest.ManifestSha256 != entry.ManifestSha256 || ManifestHash(skill.Manifest) != entry.ManifestSha256)
                    throw Error("Cached artifact manifest mismatch");
                foreach (var file in skill.Manifest.Files)
                {
                    var relative = $"skills/{skill.Position:D6}-{skill.SkillId}/{skill.RootDirectory}/{file.Path}";
                    var absolute = Path.Combine(directory, relative.Replace('/', Path.DirectorySeparatorChar));
                    var bytes = await File.ReadAllBytesAsync(absolute, cancellationToken).ConfigureAwait(false);
                    if (bytes.LongLength != file.ByteLength || Sha256(bytes) != file.RawSha256)
                        throw Error($"Cached artifact failed verification: {file.Path}");
                    expectedFiles.Add(relative);
                }
            }
            var diskFiles = EnumerateFilesSecurely(directory);
            if (!expectedFiles.SetEquals(diskFiles))
                throw Error("Cache contains missing or unexpected files");
            return metadata;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (IntelligenceSdkException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            throw Error("Cached skill set failed verification", innerException: error);
        }
    }

    private static HashSet<string> EnumerateFilesSecurely(string root)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        foreach (var path in Directory.EnumerateFileSystemEntries(root, "*", SearchOption.AllDirectories))
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw Error("Cache contains a link or special file");
            if ((attributes & FileAttributes.Directory) == 0)
                result.Add(Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'));
        }
        return result;
    }

    private SkillArtifactManifest ValidateManifest(SkillSetProjectionEntry entry)
    {
        var manifest = entry.Manifest ?? throw Error("Registry entry is missing an artifact manifest", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
        ValidateManifestObject(manifest);
        if (manifest.BundleSha256 != entry.BundleSha256 || manifest.BundleByteLength != entry.BundleByteLength ||
            manifest.ManifestSha256 != entry.ManifestSha256 || ManifestHash(manifest) != entry.ManifestSha256)
            throw Error("Artifact manifest integrity mismatch", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
        return manifest;
    }

    private void ValidateManifestObject(SkillArtifactManifest manifest)
    {
        if (manifest.ManifestVersion != 1 || string.IsNullOrEmpty(manifest.AgentSkillsProfile) || manifest.Files.Count == 0 ||
            manifest.BundleByteLength <= 0 || !ValidHash(manifest.BundleSha256) || !ValidHash(manifest.ManifestSha256))
            throw Error("Invalid artifact manifest", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
        var collisions = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in manifest.Files)
        {
            ValidateRelativePath(file.Path);
            if (string.IsNullOrEmpty(file.Role) || string.IsNullOrEmpty(file.MediaType) || file.ByteLength < 0 || !ValidHash(file.RawSha256))
                throw Error("Invalid artifact file manifest", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
            if (!collisions.Add(file.Path.Normalize(NormalizationForm.FormC).ToUpperInvariant()))
                throw Error("Artifact manifest path collision", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
        }
        if (!manifest.Files.Any(file => file.Path == "SKILL.md"))
            throw Error("Artifact manifest must contain SKILL.md", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
    }

    private static void AssertProjectionMatchesCachedSkills(SkillSetProjection projection, CacheMetadata metadata)
    {
        if (projection.Entries.Count != metadata.Projection.Entries.Count)
            throw Error("Skill-set hash resolved to a different skill count");
        for (var index = 0; index < projection.Entries.Count; index++)
        {
            var left = projection.Entries[index];
            var right = metadata.Projection.Entries[index];
            if (left.SkillId != right.SkillId || left.VersionId != right.VersionId || left.Position != right.Position ||
                left.BundleSha256 != right.BundleSha256 || left.ManifestSha256 != right.ManifestSha256 || left.BundleByteLength != right.BundleByteLength)
                throw Error("Skill-set hash resolved to different immutable skill content");
        }
    }

    private void ValidateProjection(SkillSetProjection projection, string learningContainerId)
    {
        if (projection.SchemaVersion != 1 || projection.LearningContainerId != learningContainerId ||
            string.IsNullOrEmpty(projection.RegistryRevision) || string.IsNullOrEmpty(projection.ETag) ||
            projection.PublishedAt == default || !ValidHash(projection.SkillSetHash))
            throw Error("Registry returned an invalid canonical projection");
        if (projection.Revoked && projection.Entries.Count != 0)
            throw Error("A revoked projection must be empty");
        var skills = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < projection.Entries.Count; index++)
        {
            var entry = projection.Entries[index];
            if (entry.Position != index || entry.Position > 999_999 || !CanonicalUuid.IsMatch(entry.SkillId) ||
                !CanonicalUuid.IsMatch(entry.VersionId) || !skills.Add(entry.SkillId) || string.IsNullOrEmpty(entry.Name) ||
                entry.BundleByteLength <= 0 || !ValidHash(entry.BundleSha256) || !ValidHash(entry.ManifestSha256) ||
                entry.ApprovalMethod is not ("manual" or "automatic") || entry.BundleLocator is null || entry.BundleLocator.SchemaVersion != 1 ||
                string.IsNullOrEmpty(entry.BundleLocator.BackendId) ||
                entry.BundleLocator.Provider is not ("awsS3" or "googleCloudStorage" or "azureBlob" or "s3Compatible") ||
                string.IsNullOrEmpty(entry.BundleLocator.Resource) || string.IsNullOrEmpty(entry.BundleLocator.Key) ||
                entry.BundleLocator.ByteLength < 0 || string.IsNullOrEmpty(entry.BundleLocator.ContentType) ||
                !ValidHash(entry.BundleLocator.ApplicationSha256))
                throw Error("Registry projection has invalid ordered skill entries");
        }
    }

    private async Task<HttpResponseMessage> RequestAsync(Uri uri, string? etag, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.AccessToken);
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Accept.ParseAdd("application/zip");
        if (etag is not null && !request.Headers.TryAddWithoutValidation("If-None-Match", etag))
            throw Error("Cached ETag could not be added to the request");
        try
        {
            return await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error) when (error is HttpRequestException or IOException)
        {
            throw Error("Registry transport failed", IntelligenceErrorCode.RegistryUnrecoverable, "dependency", error, retryable: true);
        }
    }

    private static async Task ThrowResponseAsync(HttpResponseMessage response, string pointerPath, CancellationToken cancellationToken)
    {
        var status = (int)response.StatusCode;
        if (status is 401 or 403 or 404 or 410) File.Delete(pointerPath);
        CanonicalErrorResponse? canonical = null;
        try
        {
            canonical = await DeserializeResponseAsync<CanonicalErrorResponse>(response, "Registry returned a non-canonical error", cancellationToken).ConfigureAwait(false);
        }
        catch (IntelligenceSdkException error)
        {
            throw Error($"Registry request failed with HTTP {status}", IntelligenceErrorCode.RegistryUnrecoverable, "dependency", error, status >= 500, status);
        }
        if (canonical.Error is null || string.IsNullOrEmpty(canonical.Error.Code) || string.IsNullOrEmpty(canonical.Error.Message) ||
            string.IsNullOrEmpty(canonical.Error.Category) || !CanonicalErrorCodes.Contains(canonical.Error.Code) ||
            !CanonicalErrorCategories.Contains(canonical.Error.Category) || canonical.Error.Retryable is null || string.IsNullOrEmpty(canonical.RequestId) ||
            string.IsNullOrEmpty(canonical.TraceId))
            throw Error($"Registry returned a non-canonical HTTP {status} error", IntelligenceErrorCode.RegistryUnrecoverable, "dependency", status: status, retryable: status >= 500);
        if (canonical.Error.Code is "LEARNING_REGISTRY_UNRECOVERABLE" or "LEARNING_CONTAINER_ARCHIVED" or "LEARNING_CONTAINER_PROJECT_MISMATCH" or "LEARNING_CONTAINER_NOT_FOUND")
            File.Delete(pointerPath);
        throw new IntelligenceSdkException(canonical.Error.Message, canonical.Error.Code,
            canonical.Error.Category, canonical.Error.Retryable.Value, status, canonical.RequestId, canonical.TraceId);
    }

    private static async Task<T> DeserializeResponseAsync<T>(HttpResponseMessage response, string message, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            return await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken).ConfigureAwait(false)
                ?? throw Error(message);
        }
        catch (JsonException error)
        {
            throw Error(message, innerException: error);
        }
    }

    private static async Task<T> ReadJsonAsync<T>(string path, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
            return await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken).ConfigureAwait(false)
                ?? throw Error($"Invalid cache JSON at {path}");
        }
        catch (IntelligenceSdkException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            throw Error($"Invalid cache JSON at {path}", innerException: error);
        }
    }

    private async Task<CachePointer> ReadPointerAsync(string path, string learningContainerId, CancellationToken cancellationToken)
    {
        var pointer = await ReadJsonAsync<CachePointer>(path, cancellationToken).ConfigureAwait(false);
        if (pointer.SchemaVersion != 1 || string.IsNullOrEmpty(pointer.ETag) || pointer.SkillSetHash != pointer.Projection.SkillSetHash || pointer.ETag != pointer.Projection.ETag)
            throw Error("Invalid current cache pointer");
        ValidateProjection(pointer.Projection, learningContainerId);
        return pointer;
    }

    private static async Task WriteJsonAtomicAsync<T>(string path, T value, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = $"{path}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        try
        {
            await WriteNewFileAsync(temporary, JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions), cancellationToken).ConfigureAwait(false);
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            File.Delete(temporary);
        }
    }

    private static async Task WriteNewFileAsync(string path, byte[] bytes, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous | FileOptions.WriteThrough);
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private InstalledSkillSet Result(string directory, CacheMetadata metadata, SkillSetProjection projection, CacheFreshness freshness) =>
        new(freshness, projection, directory, metadata.Skills.Select(skill => new InstalledSkill(
            skill.SkillId, skill.VersionId, skill.Position,
            Path.Combine(directory, "skills", $"{skill.Position:D6}-{skill.SkillId}", skill.RootDirectory))).ToArray());

    private CachePaths Paths(string learningContainerId)
    {
        var namespaceHash = Sha256(Encoding.UTF8.GetBytes(_options.ProjectNamespace));
        var container = Path.Combine(_options.CacheRoot, "v1", namespaceHash, learningContainerId);
        return new CachePaths(namespaceHash, container, Path.Combine(container, "sets"), Path.Combine(container, PointerFile));
    }

    private Uri ProjectionUrl(string learningContainerId) =>
        new(_options.BaseUrl, $"v1/learning-containers/{Uri.EscapeDataString(learningContainerId)}/skills");

    private Uri BundleUrl(string learningContainerId, SkillSetProjectionEntry entry) =>
        !string.IsNullOrEmpty(entry.DownloadUrl)
            ? new Uri(_options.BaseUrl, entry.DownloadUrl)
            : new Uri(ProjectionUrl(learningContainerId), $"skills/{Uri.EscapeDataString(entry.SkillId)}/versions/{Uri.EscapeDataString(entry.VersionId)}/bundle");

    private void ValidateRelativePath(string path)
    {
        if (string.IsNullOrEmpty(path) || path.Length > _limits.MaxPathLength || path.Contains('\0') || path.Contains('\\') ||
            path.StartsWith("/", StringComparison.Ordinal) || (path.Length >= 2 && char.IsAsciiLetter(path[0]) && path[1] == ':') ||
            path.Split('/').Any(part => part is "" or "." or ".."))
            throw Error($"Unsafe artifact path: {path}", IntelligenceErrorCode.BlobIntegrityFailure, "validation");
    }

    private static void ValidateContainerId(string value)
    {
        if (string.IsNullOrEmpty(value) || !CanonicalUuid.IsMatch(value)) throw Error("learningContainerId must be a canonical UUID", IntelligenceErrorCode.RegistryUnrecoverable, "validation");
    }

    private static bool ValidHash(string value) => value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static string Sha256(byte[] value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

    private static string ManifestHash(SkillArtifactManifest manifest)
    {
        using var document = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions));
        return Sha256(Encoding.UTF8.GetBytes(CanonicalJson(document.RootElement, omitManifestHash: true)));
    }

    private static string CanonicalJson(JsonElement element, bool omitManifestHash = false)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Object => "{" + string.Join(",", element.EnumerateObject()
                .Where(property => !omitManifestHash || property.Name != "manifestSha256")
                .OrderBy(property => property.Name, StringComparer.Ordinal)
                .Select(property => JsonSerializer.Serialize(property.Name) + ":" + CanonicalJson(property.Value))) + "}",
            JsonValueKind.Array => "[" + string.Join(",", element.EnumerateArray().Select(item => CanonicalJson(item))) + "]",
            _ => element.GetRawText(),
        };
    }

    private static IntelligenceSdkException Error(
        string message,
        IntelligenceErrorCode code = IntelligenceErrorCode.CacheCorrupt,
        string category = "internal",
        Exception? innerException = null,
        bool retryable = false,
        int? status = null) => new(message, code, category, retryable, status, innerException: innerException);

    private static void DeleteDirectory(string path)
    {
        if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
    }

    private sealed record CachePaths(string NamespaceHash, string Container, string Sets, string Pointer);
    private sealed record CachePointer(int SchemaVersion, string SkillSetHash, string ETag, SkillSetProjection Projection);
    private sealed record CachedSkillMetadata(string SkillId, string VersionId, int Position, string RootDirectory, SkillArtifactManifest Manifest);
    private sealed record CacheMetadata(int SchemaVersion, string ProjectNamespaceSha256, SkillSetProjection Projection, List<CachedSkillMetadata> Skills);
    private sealed record ArchiveFile(string ArchivePath, byte[] Bytes);
    private sealed record ResolvedLimits(long MaxBundleBytes, int MaxFiles, long MaxFileBytes, long MaxUncompressedBytes, int MaxPathLength)
    {
        public static ResolvedLimits From(IntelligenceSdkLimits? value)
        {
            var result = new ResolvedLimits(value?.MaxBundleBytes ?? 50L * 1024 * 1024, value?.MaxFiles ?? 1000,
                value?.MaxFileBytes ?? 10L * 1024 * 1024, value?.MaxUncompressedBytes ?? 100L * 1024 * 1024, value?.MaxPathLength ?? 512);
            if (result.MaxBundleBytes <= 0 || result.MaxFiles <= 0 || result.MaxFileBytes <= 0 || result.MaxUncompressedBytes <= 0 || result.MaxPathLength <= 0)
                throw Error("SDK limits must be positive", IntelligenceErrorCode.RegistryUnrecoverable, "validation");
            return result;
        }
    }

    private sealed class CanonicalErrorResponse
    {
        public CanonicalError? Error { get; set; }
        public string? RequestId { get; set; }
        public string? TraceId { get; set; }
    }

    private sealed class CanonicalError
    {
        public string Code { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public string? Category { get; set; }
        public bool? Retryable { get; set; }
    }
}
