using System.Text.Json;
using CopilotKit.Intelligence;
using CopilotKit.Intelligence.AgentFramework;

using var fixtures = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "snapshots.v1.json")));
var failures = new List<string>();
foreach (var fixture in fixtures.RootElement.GetProperty("cases").EnumerateArray())
{
    var name = fixture.GetProperty("name").GetString()!;
    var expected = fixture.GetProperty("expected").GetString();
    try
    {
        var response = new LearnedSkillsSnapshot(Convert.FromBase64String(fixture.GetProperty("archiveBase64").GetString()!),
            fixture.GetProperty("revision").GetString()!, fixture.GetProperty("etag").GetString()!, "application/zip");
        var snapshot = SkillSnapshot.Parse(response);
        if (expected != "valid") throw new Exception("accepted invalid fixture");
        if (snapshot.Revision != response.Revision) throw new Exception("revision changed");
        Console.WriteLine("PASS " + name);
    }
    catch (LearnedSkillsException error)
    {
        if (expected != error.Code)
            failures.Add(name + ": " + error.Code);
    }
    catch (Exception error) { failures.Add(name + ": " + error.Message); }
}
Run("exact text and metadata", () => {
    var response = Response("text-skill");
    var snapshot = SkillSnapshot.Parse(response);
    if (snapshot.ETag != response.ETag || snapshot.Skills.Single().Description != "Use when handling refunds."
        || snapshot.Read("refund-policy", "SKILL.md") != "# Refund policy\nUse the published refund policy.\n"
        || snapshot.Read("refund-policy", "reference.txt") != "Refunds are available for 30 days.\n")
        throw new Exception("published text or metadata changed");
    Array.Fill(response.Bytes, (byte)0);
    if (snapshot.Read("refund-policy", "reference.txt") != "Refunds are available for 30 days.\n")
        throw new Exception("snapshot retained mutable response bytes");
    Throws<ArgumentException>(() => snapshot.Read("other", "SKILL.md"));
    Throws<ArgumentException>(() => snapshot.Read("refund-policy", "../SKILL.md"));
});
Run("binary file remains a tool error", () =>
    Throws<NotSupportedException>(() => SkillSnapshot.Parse(Response("binary-resource")).Read("refund-policy", "resource.bin")));
Run("cancellation stays cancellation", () =>
    Throws<OperationCanceledException>(() => SkillSnapshot.Parse(Response("text-skill"), new CancellationToken(true))));
Run("JSON integral number representations", () => {
    var response = Response("text-skill");
    using var original = new System.IO.Compression.ZipArchive(new MemoryStream(response.Bytes));
    using var bytes = new MemoryStream();
    using (var archive = new System.IO.Compression.ZipArchive(bytes, System.IO.Compression.ZipArchiveMode.Create, true))
        foreach (var member in original.Entries)
        {
            using var input = member.Open();
            using var output = archive.CreateEntry(member.FullName).Open();
            if (member.FullName == "manifest.json")
            {
                using var reader = new StreamReader(input);
                var manifest = reader.ReadToEnd().Replace("\"schemaVersion\":1", "\"schemaVersion\":1.0").Replace("\"size\":49", "\"size\":49.0");
                output.Write(System.Text.Encoding.UTF8.GetBytes(manifest));
            }
            else input.CopyTo(output);
        }
    var changed = bytes.ToArray();
    var parsed = SkillSnapshot.Parse(response with { Bytes = changed, ETag = "\"" + SkillSnapshot.Hash(changed) + "\"" });
    if (parsed.Read("refund-policy", "SKILL.md") != "# Refund policy\nUse the published refund policy.\n") throw new Exception("integral numbers changed content");
});
Run("corrupt archive checksum is rejected", () => {
    var response = Response("text-skill");
    for (var offset = 0; offset < response.Bytes.Length - 20; offset++)
    {
        var signature = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(response.Bytes.AsSpan(offset));
        var crcOffset = signature == 0x04034b50 ? 14 : signature == 0x02014b50 ? 16 : -1;
        if (crcOffset >= 0) Array.Clear(response.Bytes, offset + crcOffset, 4);
    }
    response = response with { ETag = "\"" + SkillSnapshot.Hash(response.Bytes) + "\"" };
    try { SkillSnapshot.Parse(response); }
    catch (LearnedSkillsException error) when (error.Code == "INVALID_SNAPSHOT") { return; }
    throw new Exception("accepted corrupt archive checksum");
});
try { await RegistryTests.RunAsync(); await RegistryTests.ConcurrencyAsync(); await RegistryTests.DeadlineAsync(); await RegistryTests.ConfigurationAsync(); }
catch (Exception error) { failures.Add("registry: " + error); }
try { await FrameworkTests.RunAsync(); await FrameworkTests.DependencyInjectionAsync(); await FrameworkTests.DenialAsync(); await FrameworkTests.GuardsAsync(); }
catch (Exception error) { failures.Add("framework: " + error); }
foreach (var failure in failures) Console.Error.WriteLine("FAIL " + failure);
return failures.Count == 0 ? 0 : 1;

LearnedSkillsSnapshot Response(string name)
{
    var fixture = fixtures.RootElement.GetProperty("cases").EnumerateArray().Single(item => item.GetProperty("name").GetString() == name);
    return new LearnedSkillsSnapshot(Convert.FromBase64String(fixture.GetProperty("archiveBase64").GetString()!),
        fixture.GetProperty("revision").GetString()!, fixture.GetProperty("etag").GetString()!, "application/zip");
}
void Run(string name, Action test)
{
    try { test(); Console.WriteLine("PASS " + name); }
    catch (Exception error) { failures.Add(name + ": " + error.Message); }
}
static void Throws<T>(Action action) where T : Exception
{
    try { action(); }
    catch (T) { return; }
    throw new Exception("Expected " + typeof(T).Name);
}
