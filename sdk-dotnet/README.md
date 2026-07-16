# CopilotKit Intelligence for .NET

Verified, cancellation-aware consumption of CopilotKit Intelligence skill registries for .NET 8 applications.

```csharp
using CopilotKit.Intelligence;

using var intelligence = new IntelligenceClient(new IntelligenceClientOptions(
    new Uri("https://intelligence.example.com/"),
    Environment.GetEnvironmentVariable("COPILOTKIT_API_KEY")!,
    "my-project",
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "copilotkit")));

var skills = await intelligence.GetAsync(learningContainerId, cancellationToken);
foreach (var skill in skills.Skills)
    Console.WriteLine(Path.Combine(skill.Directory, "SKILL.md"));
```

`GetAsync` always contacts the registry, conditionally with the cached ETag. A `304` is accepted only after fully verifying the local manifest and every file; corrupt data triggers one unconditional repair request. Network failures never silently return stale data.

Use `GetCachedAsync` only when explicit offline operation is intended. It performs the same complete verification and fails with `IntelligenceSdkException` if the pointer, metadata, or materialized files are missing or corrupt.

The cache is content-addressed by `skillSetHash` under `v1/<project-namespace-sha256>/<learning-container-id>/sets/`. Installations stage on the same volume and atomically converge concurrent writers.
