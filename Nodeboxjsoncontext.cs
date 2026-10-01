using System.Text.Json.Serialization;

namespace NodeBox;

/// <summary>AOT-safe JSON serialization context for types that cross the JS bridge.</summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(FileOpenResult))]
[JsonSerializable(typeof(string))]
internal partial class NodeBoxJsonContext : JsonSerializerContext { }

/// <summary>Result of a native file-open operation, serialised to JSON for the page.</summary>
/// <param name="Path">Absolute path of the opened file, or "" on error.</param>
/// <param name="Content">UTF-8 text content, or "" on error.</param>
/// <param name="Error">Human-readable message when the read failed, otherwise null.</param>
internal record FileOpenResult(string Path, string Content, string? Error = null);