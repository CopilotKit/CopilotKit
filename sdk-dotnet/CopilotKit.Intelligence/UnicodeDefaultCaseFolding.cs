using System.Text;

namespace CopilotKit.Intelligence;

/// <summary>
/// The single .NET definition of Unicode Default Case Folding.
/// </summary>
/// <remarks>
/// Every collision key in this SDK - ZIP member paths, artifact manifest paths,
/// cached file paths, and the portable contract validator's caseFold
/// normalization - is derived here so that the folding rule cannot drift between
/// the SDK's own checks and the corpus-driven validator, or between C#,
/// TypeScript, and Python. The BCL exposes no full-folding primitive:
/// <c>ToUpperInvariant</c> and <c>ToLowerInvariant</c> apply simple case mapping
/// only, so they neither expand U+00DF to "ss" nor fold U+0130, and using them
/// silently accepts path collisions the conformance corpus declares invalid.
/// </remarks>
internal static class UnicodeDefaultCaseFolding
{
    /// <summary>
    /// Applies Unicode 17.0.0 full Default Case Folding (C and F mappings).
    /// Locale-specific Turkic (T) mappings are deliberately excluded.
    /// </summary>
    internal static string Fold(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var builder = new StringBuilder(value.Length);
        for (var index = 0; index < value.Length;)
        {
            var isSurrogatePair = char.IsHighSurrogate(value[index]) &&
                index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]);
            var length = isSurrogatePair ? 2 : 1;
            var codePoint = isSurrogatePair ? char.ConvertToUtf32(value[index], value[index + 1]) : value[index];
            if (UnicodeDefaultCaseFoldingData.Mappings.TryGetValue(codePoint, out var mapping))
                builder.Append(mapping);
            else
                builder.Append(value, index, length);
            index += length;
        }
        return builder.ToString();
    }

    /// <summary>Derives a normalization-then-folding collision key.</summary>
    internal static string FoldNormalized(string value, NormalizationForm form = NormalizationForm.FormC) =>
        Fold(value.Normalize(form));
}
