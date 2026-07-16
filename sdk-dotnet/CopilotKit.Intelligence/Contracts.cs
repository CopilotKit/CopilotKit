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
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; }

    [JsonPropertyName("learningContainerId")]
    public string LearningContainerId { get; set; } = string.Empty;

    [JsonPropertyName("registryRevision")]
    public string RegistryRevision { get; set; } = string.Empty;

    [JsonPropertyName("skillSetHash")]
    public string SkillSetHash { get; set; } = string.Empty;

    [JsonPropertyName("etag")]
    public string ETag { get; set; } = string.Empty;

    [JsonPropertyName("entries")]
    public List<SkillSetProjectionEntry> Entries { get; set; } = [];

    [JsonPropertyName("publishedAt")]
    public DateTimeOffset PublishedAt { get; set; }

    [JsonPropertyName("revoked")]
    public bool Revoked { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed class SkillSetProjectionEntry
{
    [JsonPropertyName("skillId")]
    public string SkillId { get; set; } = string.Empty;

    [JsonPropertyName("versionId")]
    public string VersionId { get; set; } = string.Empty;

    [JsonPropertyName("position")]
    public int Position { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("bundleLocator")]
    public BlobLocator BundleLocator { get; set; } = new();

    [JsonPropertyName("bundleSha256")]
    public string BundleSha256 { get; set; } = string.Empty;

    [JsonPropertyName("manifestSha256")]
    public string ManifestSha256 { get; set; } = string.Empty;

    [JsonPropertyName("bundleByteLength")]
    public long BundleByteLength { get; set; }

    [JsonPropertyName("approvalMethod")]
    public string ApprovalMethod { get; set; } = string.Empty;

    [JsonPropertyName("manifest")]
    public SkillArtifactManifest? Manifest { get; set; }

    [JsonPropertyName("artifactManifest")]
    public SkillArtifactManifest? ArtifactManifest { get; set; }

    [JsonPropertyName("downloadUrl")]
    public string? DownloadUrl { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed class BlobLocator
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; }

    [JsonPropertyName("backendId")]
    public string BackendId { get; set; } = string.Empty;

    [JsonPropertyName("provider")]
    public string Provider { get; set; } = string.Empty;

    [JsonPropertyName("resource")]
    public string Resource { get; set; } = string.Empty;

    [JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;

    [JsonPropertyName("providerVersion")]
    public string? ProviderVersion { get; set; }

    [JsonPropertyName("etag")]
    public string? ETag { get; set; }

    [JsonPropertyName("applicationSha256")]
    public string ApplicationSha256 { get; set; } = string.Empty;

    [JsonPropertyName("providerChecksum")]
    public JsonElement? ProviderChecksum { get; set; }

    [JsonPropertyName("byteLength")]
    public long ByteLength { get; set; }

    [JsonPropertyName("contentType")]
    public string ContentType { get; set; } = string.Empty;

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed class SkillArtifactManifest
{
    [JsonPropertyName("manifestVersion")]
    public int ManifestVersion { get; set; }

    [JsonPropertyName("agentSkillsProfile")]
    public string AgentSkillsProfile { get; set; } = string.Empty;

    [JsonPropertyName("files")]
    public List<SkillArtifactFile> Files { get; set; } = [];

    [JsonPropertyName("manifestSha256")]
    public string ManifestSha256 { get; set; } = string.Empty;

    [JsonPropertyName("bundleSha256")]
    public string BundleSha256 { get; set; } = string.Empty;

    [JsonPropertyName("bundleByteLength")]
    public long BundleByteLength { get; set; }

    [JsonPropertyName("provenance")]
    public JsonElement Provenance { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

public sealed class SkillArtifactFile
{
    [JsonPropertyName("path")]
    public string Path { get; set; } = string.Empty;

    [JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;

    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = string.Empty;

    [JsonPropertyName("byteLength")]
    public long ByteLength { get; set; }

    [JsonPropertyName("rawSha256")]
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
