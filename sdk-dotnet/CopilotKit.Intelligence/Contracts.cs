using System.Text.Json;
using System.Text.Json.Serialization;

namespace CopilotKit.Intelligence;

public sealed record IntelligenceClientOptions(
    Uri BaseUrl,
    string AccessToken,
    string ProjectNamespace,
    string CacheRoot,
    IntelligenceSdkLimits? Limits = null);

public sealed record IntelligenceSdkLimits(
    long? MaxBundleBytes = null,
    int? MaxFiles = null,
    long? MaxFileBytes = null,
    long? MaxUncompressedBytes = null,
    int? MaxPathLength = null);

public enum CacheFreshness
{
    Fresh,
    Cached,
}

public sealed class SkillSetProjection
{
    [JsonRequired, JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; }

    [JsonRequired, JsonPropertyName("learningContainerId")]
    public string LearningContainerId { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("registryRevision")]
    public string RegistryRevision { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("skillSetHash")]
    public string SkillSetHash { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("etag")]
    public string ETag { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("entries")]
    public List<SkillSetProjectionEntry> Entries { get; set; } = [];

    [JsonRequired, JsonPropertyName("publishedAt")]
    public DateTimeOffset PublishedAt { get; set; }

    [JsonRequired, JsonPropertyName("revoked")]
    public bool Revoked { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed class SkillSetProjectionEntry
{
    [JsonRequired, JsonPropertyName("skillId")]
    public string SkillId { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("versionId")]
    public string VersionId { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("position")]
    public int Position { get; set; }

    [JsonRequired, JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonRequired, JsonPropertyName("bundleLocator")]
    public BlobLocator BundleLocator { get; set; } = new();

    [JsonRequired, JsonPropertyName("bundleSha256")]
    public string BundleSha256 { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("manifestSha256")]
    public string ManifestSha256 { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("bundleByteLength")]
    public long BundleByteLength { get; set; }

    [JsonRequired, JsonPropertyName("approvalMethod")]
    public string ApprovalMethod { get; set; } = string.Empty;

    [JsonPropertyName("manifest")]
    public SkillArtifactManifest? Manifest { get; set; }

    [JsonPropertyName("downloadUrl")]
    public string? DownloadUrl { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed class BlobLocator
{
    [JsonRequired, JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; }

    [JsonRequired, JsonPropertyName("backendId")]
    public string BackendId { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("provider")]
    public string Provider { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("resource")]
    public string Resource { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("providerVersion")]
    public string? ProviderVersion { get; set; }

    [JsonRequired, JsonPropertyName("etag")]
    public string? ETag { get; set; }

    [JsonRequired, JsonPropertyName("applicationSha256")]
    public string ApplicationSha256 { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("providerChecksum")]
    public JsonElement? ProviderChecksum { get; set; }

    [JsonRequired, JsonPropertyName("byteLength")]
    public long ByteLength { get; set; }

    [JsonRequired, JsonPropertyName("contentType")]
    public string ContentType { get; set; } = string.Empty;

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed class SkillArtifactManifest
{
    [JsonRequired, JsonPropertyName("manifestVersion")]
    public int ManifestVersion { get; set; }

    [JsonRequired, JsonPropertyName("agentSkillsProfile")]
    public string AgentSkillsProfile { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("files")]
    public List<SkillArtifactFile> Files { get; set; } = [];

    [JsonRequired, JsonPropertyName("manifestSha256")]
    public string ManifestSha256 { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("bundleSha256")]
    public string BundleSha256 { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("bundleByteLength")]
    public long BundleByteLength { get; set; }

    [JsonRequired, JsonPropertyName("provenance")]
    public JsonElement Provenance { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed class SkillArtifactFile
{
    [JsonRequired, JsonPropertyName("path")]
    public string Path { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = string.Empty;

    [JsonRequired, JsonPropertyName("byteLength")]
    public long ByteLength { get; set; }

    [JsonRequired, JsonPropertyName("rawSha256")]
    public string RawSha256 { get; set; } = string.Empty;

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed record InstalledSkill(string SkillId, string VersionId, int Position, string Directory);

public sealed record InstalledSkillSet(
    CacheFreshness Freshness,
    SkillSetProjection Projection,
    string Directory,
    IReadOnlyList<InstalledSkill> Skills);
