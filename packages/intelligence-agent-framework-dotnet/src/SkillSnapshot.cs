using System.Collections.Immutable;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CopilotKit.Intelligence.AgentFramework;

internal sealed record SkillFile(string Path, int Size, string Sha256, string? Text);
internal sealed record PublishedSkill(string Name, string Description, ImmutableArray<SkillFile> Files);

/// <summary>A complete immutable snapshot; construction validates every member.</summary>
internal sealed class SkillSnapshot(string revision, string etag, ImmutableArray<PublishedSkill> skills)
{
    internal const int MaxBytes = 32 * 1024 * 1024;
    internal static readonly UTF8Encoding Utf8 = new(false, true);
    internal string Revision { get; } = revision;
    internal string ETag { get; } = etag;
    internal ImmutableArray<PublishedSkill> Skills { get; } = skills;

    internal static SkillSnapshot Parse(LearnedSkillsSnapshot response, CancellationToken cancellationToken = default)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (response.Bytes.Length > MaxBytes || string.IsNullOrEmpty(response.Revision)
                || !string.Equals(response.ContentType.Split(';')[0].Trim(), "application/zip", StringComparison.OrdinalIgnoreCase))
                throw Invalid();
            var bytes = response.Bytes.ToArray();
            if (response.ETag != "\"" + Hash(bytes) + "\"") throw Invalid();
            var archive = SnapshotArchive.Read(bytes, cancellationToken);
            if (!archive.TryGetValue("manifest.json", out var manifestBytes)) throw Invalid();
            using var document = JsonDocument.Parse(Utf8.GetString(manifestBytes));
            var manifest = document.RootElement;
            if (manifest.ValueKind != JsonValueKind.Object) throw Invalid();
            if (manifest.TryGetProperty("schemaVersion", out var version) && version.ValueKind == JsonValueKind.Number
                && version.GetDouble() != 1) throw new LearnedSkillsException("UNSUPPORTED_SERVER", false);
            if (version.ValueKind != JsonValueKind.Number || version.GetDouble() != 1
                || manifest.GetProperty("revision").GetString() != response.Revision) throw Invalid();
            var items = manifest.GetProperty("skills");
            if (items.ValueKind != JsonValueKind.Array || items.GetArrayLength() > 100) throw Invalid();
            var expected = new HashSet<string>(StringComparer.Ordinal) { "manifest.json" };
            var skills = ImmutableArray.CreateBuilder<PublishedSkill>();
            string? previousName = null;
            foreach (var item in items.EnumerateArray())
            {
                cancellationToken.ThrowIfCancellationRequested();
                var name = item.GetProperty("name").GetString();
                var description = item.GetProperty("description").GetString();
                if (name is null || !SafePath(name) || name.Contains('/') || description is null
                    || previousName is not null && Compare(previousName, name) >= 0) throw Invalid();
                previousName = name;
                var files = ImmutableArray.CreateBuilder<SkillFile>();
                string? previousPath = null;
                var hasSkill = false;
                foreach (var file in item.GetProperty("files").EnumerateArray())
                {
                    var path = file.GetProperty("path").GetString();
                    var digest = file.GetProperty("sha256").GetString();
                    if (path is null || !SafePath(path) || previousPath is not null && Compare(previousPath, path) >= 0
                        || !FileSize(file.GetProperty("size"), out var size) || digest is null)
                        throw Invalid();
                    previousPath = path;
                    var fullPath = name + "/" + path;
                    if (!expected.Add(fullPath) || !archive.TryGetValue(fullPath, out var content)
                        || content.Length != size || Hash(content) != digest) throw Invalid();
                    string? text;
                    try { text = Utf8.GetString(content); }
                    catch (DecoderFallbackException) { text = null; }
                    if (path == "SKILL.md") { if (text is null) throw Invalid(); hasSkill = true; }
                    files.Add(new SkillFile(path, size, digest, text));
                }
                if (!hasSkill) throw Invalid();
                skills.Add(new PublishedSkill(name, description, files.ToImmutable()));
            }
            if (!expected.SetEquals(archive.Keys)) throw Invalid();
            return new SkillSnapshot(response.Revision, response.ETag, skills.ToImmutable());
        }
        catch (LearnedSkillsException) { throw; }
        catch (OperationCanceledException) { throw; }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException
            or DecoderFallbackException or InvalidDataException or ArgumentException or OverflowException or IOException)
        { throw Invalid(error); }
    }

    internal string Read(string skillName, string path)
    {
        var skill = Skills.FirstOrDefault(skill => skill.Name == skillName)
            ?? throw new ArgumentException("Unknown learned skill.", nameof(skillName));
        var file = skill.Files.FirstOrDefault(file => file.Path == path)
            ?? throw new ArgumentException("Unknown learned-skill file.", nameof(path));
        return file.Text ?? throw new NotSupportedException("The learned-skill file is not UTF-8 text.");
    }

    private static bool FileSize(JsonElement value, out int size)
    {
        size = 0;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number)
            || number < 0 || number > MaxBytes || Math.Truncate(number) != number) return false;
        size = (int)number;
        return true;
    }

    internal static LearnedSkillsException Invalid(Exception? cause = null) => new("INVALID_SNAPSHOT", false, cause);
    internal static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    internal static int Compare(string left, string right) => Utf8.GetBytes(left).AsSpan().SequenceCompareTo(Utf8.GetBytes(right));
    internal static bool SafePath(string path) => path.Length > 0 && !path.Any(c => c == '\\' || c < 32 || c == 127)
        && !(path.Length >= 2 && char.IsAsciiLetter(path[0]) && path[1] == ':')
        && path.Split('/').All(part => part is not ("" or "." or ".."));
}
