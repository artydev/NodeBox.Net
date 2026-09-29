namespace NodeBox;

/// <summary>
/// JS-callable host object exposed as chrome.webview.hostObjects.nb.
///
/// The whole NodeBox API (fill, rect, translate, …) lives in the PAGE, which
/// records calls into a compact binary frame (see FrameRenderer for the format).
/// Only one bridge call is made per frame: submit().
///
/// NOTE: the WebView2 bridge does not honour C# default parameter values
/// (a missing JS argument arrives as 0/null), so every method here takes
/// explicit arguments and the page always passes all of them.
/// </summary>
[System.Runtime.InteropServices.Marshalling.GeneratedComClass]
[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods | DynamicallyAccessedMemberTypes.PublicProperties)]
public partial class DrawingApi(NodeBoxSurface surface) : DispatchObject
{
    /// <summary>Separates entries of the string table (text never contains it: the page strips it).</summary>
    private const char StringSeparator = '\u001f';

    /// <summary>Submits one encoded frame.</summary>
    /// <param name="frameBase64">Float32Array bytes, base64-encoded.</param>
    /// <param name="strings">The frame's string table (text, font names), joined with U+001F.</param>
    /// <param name="animate">true while a draw() loop runs (keep the surface ticking);
    /// false for a one-shot render.</param>
    /// <returns>The error from the last rendered frame, or "" if it was clean.
    /// (Rendering is asynchronous, so errors surface one frame late.)</returns>
    public string submit(string frameBase64, string strings, bool animate)
    {
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(frameBase64 ?? string.Empty);
        }
        catch (FormatException ex)
        {
            return "Bad frame encoding: " + ex.Message;
        }

        if (bytes.Length % 4 != 0)
            return "Bad frame length.";

        string[] table = string.IsNullOrEmpty(strings) ? [] : strings.Split(StringSeparator);
        surface.Submit(bytes, table, animate);
        return surface.LastError;
    }

    /// <summary>
    /// Measures text exactly as text() would lay it out (DirectWrite).
    /// Returns "width height baseline" in CSS pixels, invariant culture.
    /// </summary>
    public string measure(string text, string font, double size, double lineheight, double align, double width)
    {
        try
        {
            var b = TextEngine.Get(text ?? string.Empty, font ?? string.Empty,
                (float)size, (float)lineheight, (int)align, (float)width);
            return string.Create(CultureInfo.InvariantCulture, $"{b.Width} {b.Height} {b.Baseline}");
        }
        catch (Exception ex)
        {
            return "error " + ex.Message;
        }
    }

    /// <summary>
    /// Converts text to Bézier outlines (DirectWrite glyph outlines of the same
    /// layout text() draws). Returns the path verbs as base64 float32
    /// (0 x y | 1 x y | 2 c1x c1y c2x c2y x y | 3 = close), or "error …".
    /// </summary>
    public string textpath(string text, string font, double size, double lineheight, double align,
        double x, double y, double width)
    {
        try
        {
            var verbs = TextOutline.Get(text ?? string.Empty, font ?? string.Empty,
                (float)size, (float)lineheight, (int)align, (float)x, (float)y, (float)width);
            return Convert.ToBase64String(MemoryMarshal.AsBytes(verbs.AsSpan()));
        }
        catch (Exception ex)
        {
            return "error " + ex.Message;
        }
    }

    /// <summary>Stops a running animation (the last frame stays on screen).</summary>
    public void stop() => surface.Stop();

    /// <summary>Error from the most recently rendered frame ("" if none).</summary>
    public string LastError => surface.LastError;
}
