namespace NodeBox;

/// <summary>
/// DirectWrite text layout for NodeBox's text(), shared by drawing and measuring
/// so textwidth()/textmetrics() always agree with what text() renders.
///
/// NodeBox semantics:
///   • y is the BASELINE of the first line (not the top of the box).
///   • lineheight is a multiple of the font size (default 1.2).
///   • With a width, text wraps inside a box of that width and align() positions
///     lines inside the box. Without a width, the text is a single unwrapped block
///     and align() anchors it at x (left edge / centre / right edge).
///   • Font names may carry a style suffix: "Georgia-Bold", "Arial Black",
///     "Helvetica-BoldOblique"… Common Mac names map to Windows equivalents.
///
/// Formats and layouts are cached (layouts are device-independent), so redrawing
/// the same label every animation frame costs one DrawTextLayout call.
/// All access happens on the UI thread; the lock is just a safety net.
/// </summary>
internal static class TextEngine
{
    private const int MaxCachedLayouts = 2048;
    private const float NoWrapWidth = 100_000f;

    private static readonly Lock _lock = new();
    private static IComObject<IDWriteFactory>? _factory;
    private static readonly Dictionary<string, IComObject<IDWriteTextFormat>> _formats = [];
    private static readonly Dictionary<string, TextBlock> _layouts = [];

    /// <summary>A laid-out block of text plus the metrics NodeBox needs.</summary>
    internal sealed class TextBlock(IComObject<IDWriteTextLayout> layout, float width, float height, float baseline) : IDisposable
    {
        public IComObject<IDWriteTextLayout> Layout { get; } = layout;
        public float Width { get; } = width;        // ink-independent layout width of the text
        public float Height { get; } = height;      // total height of all lines
        public float Baseline { get; } = baseline;  // top of block → first baseline
        public void Dispose() => Layout.Dispose();
    }

    /// <param name="align">0 left, 1 right, 2 center, 3 justify (= DWRITE_TEXT_ALIGNMENT values).</param>
    /// <param name="width">Wrap width, or ≤ 0 for a single unwrapped block.</param>
    public static TextBlock Get(string text, string font, float size, float lineHeight, int align, float width)
    {
        size = size > 0 && float.IsFinite(size) ? size : 24;
        lineHeight = lineHeight > 0 && float.IsFinite(lineHeight) ? lineHeight : 1.2f;
        align = Math.Clamp(align, 0, 3);
        var wrap = width > 0 && float.IsFinite(width);

        var key = string.Create(CultureInfo.InvariantCulture, $"{font}\u001f{size}\u001f{lineHeight}\u001f{align}\u001f{(wrap ? width : -1)}\u001f{text}");
        lock (_lock)
        {
            if (_layouts.TryGetValue(key, out var cached))
                return cached;

            if (_layouts.Count >= MaxCachedLayouts)
            {
                foreach (var b in _layouts.Values) b.Dispose();
                _layouts.Clear();
            }

            var format = GetFormat(font, size, lineHeight, align, wrap);
            var layout = Factory.CreateTextLayout<IDWriteTextLayout>(format.Object, text.Length == 0 ? " " : text,
                0, wrap ? width : NoWrapWidth, float.MaxValue);

            var metrics = layout.Object.GetMetrics();
            var lines = layout.Object.GetLineMetrics();
            var baseline = lines.Count > 0 ? lines[0].baseline : size * lineHeight * 0.8f;
            var w = text.Length == 0 ? 0 : (wrap ? metrics.width : metrics.widthIncludingTrailingWhitespace);

            var block = new TextBlock(layout, w, metrics.height, baseline);
            _layouts[key] = block;
            return block;
        }
    }

    private static IDWriteFactory Factory => (_factory ??= DWriteFunctions.DWriteCreateFactory()).Object;

    private static IComObject<IDWriteTextFormat> GetFormat(string font, float size, float lineHeight, int align, bool wrap)
    {
        var key = string.Create(CultureInfo.InvariantCulture, $"{font}\u001f{size}\u001f{lineHeight}\u001f{align}\u001f{wrap}");
        if (_formats.TryGetValue(key, out var format))
            return format;

        var (family, weight, style) = ParseFont(font);
        format = Factory.CreateTextFormat<IDWriteTextFormat>(family, size, null, weight, style);

        var fmt = format.Object;
        var spacing = size * lineHeight;
        fmt.SetLineSpacing(DWRITE_LINE_SPACING_METHOD.DWRITE_LINE_SPACING_METHOD_UNIFORM, spacing, spacing * 0.8f).ThrowOnError();
        // Without a wrap width the block is anchored by its measured width instead (see FrameRenderer).
        fmt.SetTextAlignment(wrap ? (DWRITE_TEXT_ALIGNMENT)align : DWRITE_TEXT_ALIGNMENT.DWRITE_TEXT_ALIGNMENT_LEADING).ThrowOnError();
        fmt.SetWordWrapping(wrap ? DWRITE_WORD_WRAPPING.DWRITE_WORD_WRAPPING_WRAP : DWRITE_WORD_WRAPPING.DWRITE_WORD_WRAPPING_NO_WRAP).ThrowOnError();

        _formats[key] = format;
        return format;
    }

    // ── Font names ───────────────────────────────────────────────────────────

    // NodeBox sketches were written on macOS; map common Mac families to Windows ones.
    private static readonly Dictionary<string, string> _familyMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Helvetica"] = "Arial",
        ["Helvetica Neue"] = "Arial",
        ["HelveticaNeue"] = "Arial",
        ["Lucida Grande"] = "Segoe UI",
        ["LucidaGrande"] = "Segoe UI",
        ["San Francisco"] = "Segoe UI",
        ["SF Pro"] = "Segoe UI",
        ["Times"] = "Times New Roman",
        ["Courier"] = "Courier New",
        ["Monaco"] = "Consolas",
        ["Menlo"] = "Consolas",
        ["SF Mono"] = "Consolas",
        ["Gill Sans"] = "Gill Sans MT",
        ["Zapfino"] = "Gabriola",          // closest calligraphic face shipped with Windows
        ["Futura"] = "Century Gothic",
        ["Geneva"] = "Verdana",
        ["Optima"] = "Candara",
    };

    private static IComObject<IDWriteFontCollection>? _systemFonts;

    // Is `name` an installed font family? ("Arial Black" is its own family on Windows,
    // so it must not be split into Arial + weight Black.)
    private static bool FamilyExists(string name)
    {
        try
        {
            _systemFonts ??= Factory.GetSystemFontCollection<IDWriteFontCollection>();
            return _systemFonts.Object.FindFamilyNameIndex(name) >= 0;
        }
        catch
        {
            return false;
        }
    }

    private static readonly (string word, DWRITE_FONT_WEIGHT weight)[] _weights =
    [
        ("extrablack", DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_EXTRA_BLACK),
        ("ultrablack", DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_EXTRA_BLACK),
        ("extrabold",  DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_EXTRA_BOLD),
        ("ultrabold",  DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_EXTRA_BOLD),
        ("semibold",   DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_SEMI_BOLD),
        ("demibold",   DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_SEMI_BOLD),
        ("extralight", DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_EXTRA_LIGHT),
        ("ultralight", DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_EXTRA_LIGHT),
        ("semilight",  DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_SEMI_LIGHT),
        ("black",      DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_BLACK),
        ("heavy",      DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_BLACK),
        ("bold",       DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_BOLD),
        ("medium",     DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_MEDIUM),
        ("light",      DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_LIGHT),
        ("thin",       DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_THIN),
        ("regular",    DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_NORMAL),
        ("roman",      DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_NORMAL),
        ("book",       DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_NORMAL),
        ("normal",     DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_NORMAL),
    ];

    private static bool IsStyleWord(string token)
    {
        var t = token.ToLowerInvariant();
        if (t.Contains("italic") || t.Contains("oblique")) return true;
        foreach (var (word, _) in _weights)
            if (t.Contains(word)) return true;
        return false;
    }

    /// "Georgia-BoldItalic" → (Georgia, Bold, Italic); "Arial Black" → (Arial, Black, Normal).
    internal static (string family, DWRITE_FONT_WEIGHT weight, DWRITE_FONT_STYLE style) ParseFont(string? name)
    {
        name = string.IsNullOrWhiteSpace(name) ? "Helvetica" : name.Trim();

        // 1. An installed family, as written or mapped from its Mac name, wins.
        if (FamilyExists(name))
            return (name, DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STYLE.DWRITE_FONT_STYLE_NORMAL);
        if (_familyMap.TryGetValue(name, out var mappedWhole) && FamilyExists(mappedWhole))
            return (mappedWhole, DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STYLE.DWRITE_FONT_STYLE_NORMAL);

        // 2. Otherwise split a style suffix off the family name.
        var family = name;
        var styleSpec = string.Empty;

        // PostScript-style "Family-Style"
        var dash = name.LastIndexOf('-');
        if (dash > 0 && IsStyleWord(name[(dash + 1)..]))
        {
            family = name[..dash];
            styleSpec = name[(dash + 1)..];
        }
        else
        {
            // Trailing style words: "Arial Black", "Segoe UI Semibold Italic"
            var tokens = name.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
            var peeled = new List<string>();
            while (tokens.Count > 1 && IsStyleWord(tokens[^1]))
            {
                peeled.Insert(0, tokens[^1]);
                tokens.RemoveAt(tokens.Count - 1);
            }
            family = string.Join(' ', tokens);
            styleSpec = string.Join(' ', peeled);
        }

        if (_familyMap.TryGetValue(family, out var mapped))
            family = mapped;

        var spec = styleSpec.ToLowerInvariant().Replace(" ", "");
        var style = spec.Contains("italic") ? DWRITE_FONT_STYLE.DWRITE_FONT_STYLE_ITALIC
                  : spec.Contains("oblique") ? DWRITE_FONT_STYLE.DWRITE_FONT_STYLE_OBLIQUE
                  : DWRITE_FONT_STYLE.DWRITE_FONT_STYLE_NORMAL;

        var weight = DWRITE_FONT_WEIGHT.DWRITE_FONT_WEIGHT_NORMAL;
        foreach (var (word, w) in _weights)
        {
            if (spec.Contains(word)) { weight = w; break; }
        }

        return (family, weight, style);
    }
}
