using System.Text;
using CopilotKit.Intelligence;

namespace CopilotKit.Intelligence.AgentFramework.Tests;

internal sealed class FakeRegistryClient : IIntelligenceRegistryClient
{
    internal Queue<Func<CancellationToken, Task<InstalledSkillSet>>> NetworkOutcomes { get; } = new();
    internal Queue<Func<CancellationToken, Task<InstalledSkillSet>>> CachedOutcomes { get; } = new();
    internal List<string> NetworkCalls { get; } = [];
    internal List<string> CachedCalls { get; } = [];

    public Task<InstalledSkillSet> GetAsync(string learningContainerId, CancellationToken cancellationToken)
    {
        NetworkCalls.Add(learningContainerId);
        return Next(NetworkOutcomes, cancellationToken);
    }

    public Task<InstalledSkillSet> GetCachedAsync(string learningContainerId, CancellationToken cancellationToken)
    {
        CachedCalls.Add(learningContainerId);
        return Next(CachedOutcomes, cancellationToken);
    }

    private static Task<InstalledSkillSet> Next(
        Queue<Func<CancellationToken, Task<InstalledSkillSet>>> outcomes,
        CancellationToken cancellationToken)
    {
        if (outcomes.Count == 0)
        {
            throw new InvalidOperationException("Unexpected generic SDK call.");
        }

        return outcomes.Dequeue()(cancellationToken);
    }
}

internal sealed class FakeTimeProvider : TimeProvider
{
    private long _milliseconds;

    internal FakeTimeProvider(long initialMilliseconds = 0)
    {
        _milliseconds = initialMilliseconds;
    }

    public override long TimestampFrequency => 1_000;

    public override long GetTimestamp() => _milliseconds;

    public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch.AddMilliseconds(_milliseconds);

    internal void Advance(TimeSpan duration) => _milliseconds += (long)duration.TotalMilliseconds;

    internal long Milliseconds => _milliseconds;

    internal void SetMilliseconds(long milliseconds)
    {
        if (milliseconds < _milliseconds)
        {
            throw new ArgumentOutOfRangeException(nameof(milliseconds), "Fake monotonic time cannot move backwards.");
        }

        _milliseconds = milliseconds;
    }
}

internal static class TestSkillSets
{
    internal const string ContainerId = "55555555-5555-4555-8555-555555555555";
    internal const string SkillId = "99999999-9999-4999-8999-999999999999";
    internal const string VersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    internal const string RegistryRevision = "revision-1";
    internal const string ChangedRegistryRevision = "revision-2";
    internal const string SkillName = "Safe skill";

    internal static InstalledSkillSet Create(
        string root,
        string text = "# Skill\n",
        CacheFreshness freshness = CacheFreshness.Fresh,
        bool revoked = false,
        string role = "instructions",
        string manifestPath = "SKILL.md",
        string registryRevision = RegistryRevision)
    {
        return CreateMany(
            root,
            revoked ? [] : [text],
            freshness,
            revoked,
            revoked ? [] : [role],
            revoked ? [] : [manifestPath],
            registryRevision);
    }

    internal static InstalledSkillSet CreateMany(
        string root,
        IReadOnlyList<string> texts,
        CacheFreshness freshness = CacheFreshness.Fresh,
        bool revoked = false,
        IReadOnlyList<string>? roles = null,
        IReadOnlyList<string>? manifestPaths = null,
        string registryRevision = RegistryRevision)
    {
        roles ??= Enumerable.Repeat("instructions", texts.Count).ToArray();
        manifestPaths ??= Enumerable.Repeat("SKILL.md", texts.Count).ToArray();
        var entries = new List<SkillSetProjectionEntry>();
        var installed = new List<InstalledSkill>();
        for (var index = 0; index < texts.Count; index++)
        {
            var directory = Path.Combine(root, $"skill-{index}");
            Directory.CreateDirectory(directory);
            var bytes = Encoding.UTF8.GetBytes(texts[index]);
            File.WriteAllBytes(Path.Combine(directory, "SKILL.md"), bytes);
            var skillId = index == 0
                ? SkillId
                : $"{index + 1:00000000}-9999-4999-8999-999999999999";
            var versionId = index == 0
                ? VersionId
                : $"{index + 1:00000000}-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
            var manifest = new SkillArtifactManifest
            {
                ManifestVersion = 1,
                AgentSkillsProfile = "agentskills:v1",
                ManifestSha256 = new string('a', 64),
                BundleSha256 = new string('b', 64),
                BundleByteLength = bytes.Length,
                Files =
                [
                    new SkillArtifactFile
                    {
                        Path = manifestPaths[index],
                        Role = roles[index],
                        MediaType = "text/markdown",
                        ByteLength = bytes.Length,
                        RawSha256 = new string('c', 64),
                    },
                ],
            };
            entries.Add(new SkillSetProjectionEntry
            {
                SkillId = skillId,
                VersionId = versionId,
                Position = index,
                Name = index == 0 ? SkillName : $"Skill {index}",
                Description = null,
                Manifest = manifest,
                ManifestSha256 = manifest.ManifestSha256,
                BundleSha256 = manifest.BundleSha256,
                BundleByteLength = manifest.BundleByteLength,
                ApprovalMethod = "manual",
            });
            installed.Add(new InstalledSkill(skillId, versionId, index, directory));
        }

        var projection = new SkillSetProjection
        {
            SchemaVersion = 1,
            LearningContainerId = ContainerId,
            RegistryRevision = registryRevision,
            SkillSetHash = new string('d', 64),
            ETag = "etag-1",
            PublishedAt = DateTimeOffset.UnixEpoch,
            Revoked = revoked,
            Entries = revoked ? [] : entries,
        };

        return new InstalledSkillSet(
            freshness,
            projection,
            root,
            revoked ? [] : installed);
    }

    internal static string NewRoot() => Path.Combine(
        Path.GetTempPath(),
        $"copilotkit-agent-framework-tests-{Guid.NewGuid():N}");
}
