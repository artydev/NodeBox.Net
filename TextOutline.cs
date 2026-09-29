namespace NodeBox;

/// <summary>
/// textpath(): converts text into Bézier outlines using DirectWrite.
///
/// The text is laid out by TextEngine (the SAME layout text() draws, so kerning,
/// shaping, fallback fonts, wrapping and alignment all match), then
/// IDWriteTextLayout.Draw() walks it with our <see cref="OutlineRenderer"/>. For
/// every positioned glyph run, IDWriteFontFace.GetGlyphRunOutline() streams the
/// glyph contours into our <see cref="OutlineSink"/>, which records them as
/// NodeBox path verbs (the same encoding as the PATH op in FrameRenderer):
///
///   0 x y                      moveto
///   1 x y                      lineto
///   2 c1x c1y c2x c2y x y      curveto
///   3                          closepath (per contour)
/// </summary>
internal static class TextOutline
{
    public static float[] Get(string text, string font, float size, float lineHeight, int align,
        float x, float y, float width)
    {
        if (string.IsNullOrEmpty(text))
            return [];

        var block = TextEngine.Get(text, font, size, lineHeight, align, width);

        // Same placement rules as ID2D1RenderTarget_Proxy.Text().
        var left = x;
        if (width <= 0)
        {
            if (align == 2) left -= block.Width / 2;
            else if (align == 1) left -= block.Width;
        }
        var top = y - block.Baseline;

        var renderer = new OutlineRenderer();
        block.Layout.Object.Draw(0, renderer, left, top).ThrowOnError();
        renderer.Sink.ThrowIfFailed();
        return [.. renderer.Sink.Verbs];
    }
}

/// <summary>
/// Receives positioned glyph runs from IDWriteTextLayout.Draw and asks the font
/// face for their outlines. Underlines/strikethroughs/inline objects are ignored.
/// </summary>
[System.Runtime.InteropServices.Marshalling.GeneratedComClass]
internal sealed partial class OutlineRenderer : IDWriteTextRenderer
{
    public OutlineSink Sink { get; } = new();

    public HRESULT IsPixelSnappingDisabled(nint clientDrawingContext, out BOOL isDisabled)
    {
        isDisabled = true;              // outlines, not pixels
        return DirectN.Constants.S_OK;
    }

    public HRESULT GetCurrentTransform(nint clientDrawingContext, out DWRITE_MATRIX transform)
    {
        transform = new DWRITE_MATRIX { m11 = 1, m22 = 1 };
        return DirectN.Constants.S_OK;
    }

    public HRESULT GetPixelsPerDip(nint clientDrawingContext, out float pixelsPerDip)
    {
        pixelsPerDip = 1;
        return DirectN.Constants.S_OK;
    }

    public unsafe HRESULT DrawGlyphRun(nint clientDrawingContext, float baselineOriginX, float baselineOriginY,
        DWRITE_MEASURING_MODE measuringMode, in DWRITE_GLYPH_RUN glyphRun,
        in DWRITE_GLYPH_RUN_DESCRIPTION glyphRunDescription, nint clientDrawingEffect)
    {
        try
        {
            if (glyphRun.glyphCount == 0 || glyphRun.fontFace == 0 || glyphRun.glyphIndices == 0)
                return DirectN.Constants.S_OK;

            var indices = new ReadOnlySpan<ushort>((void*)glyphRun.glyphIndices, (int)glyphRun.glyphCount).ToArray();

            // The font face pointer is BORROWED: AddRef it because FromPointer takes
            // ownership of one reference (and releases it), then Dispose our wrapper.
            Marshal.AddRef(glyphRun.fontFace);
            using var face = ComObject.FromPointer<IDWriteFontFace>(glyphRun.fontFace)
                ?? throw new InvalidOperationException("Glyph run has no IDWriteFontFace.");

            // Outlines come relative to the baseline origin.
            Sink.OffsetX = baselineOriginX;
            Sink.OffsetY = baselineOriginY;

            var rtl = (glyphRun.bidiLevel & 1) != 0;
            return face.Object.GetGlyphRunOutline(glyphRun.fontEmSize, indices,
                glyphRun.glyphAdvances, glyphRun.glyphOffsets, glyphRun.glyphCount,
                glyphRun.isSideways, rtl, Sink);
        }
        catch (Exception ex)
        {
            Sink.Error ??= ex.Message;
            return DirectN.Constants.E_FAIL;
        }
    }

    public HRESULT DrawUnderline(nint clientDrawingContext, float baselineOriginX, float baselineOriginY,
        in DWRITE_UNDERLINE underline, nint clientDrawingEffect) => DirectN.Constants.S_OK;

    public HRESULT DrawStrikethrough(nint clientDrawingContext, float baselineOriginX, float baselineOriginY,
        in DWRITE_STRIKETHROUGH strikethrough, nint clientDrawingEffect) => DirectN.Constants.S_OK;

    public HRESULT DrawInlineObject(nint clientDrawingContext, float originX, float originY,
        IDWriteInlineObject inlineObject, BOOL isSideways, BOOL isRightToLeft, nint clientDrawingEffect) => DirectN.Constants.S_OK;
}

/// <summary>Records geometry-sink callbacks as NodeBox path verbs (see TextOutline).</summary>
[System.Runtime.InteropServices.Marshalling.GeneratedComClass]
internal sealed partial class OutlineSink : ID2D1SimplifiedGeometrySink
{
    public List<float> Verbs { get; } = [];
    public float OffsetX { get; set; }
    public float OffsetY { get; set; }
    public string? Error { get; set; }

    public void ThrowIfFailed()
    {
        if (Error != null)
            throw new InvalidOperationException(Error);
    }

    public void SetFillMode(D2D1_FILL_MODE fillMode) { }
    public void SetSegmentFlags(D2D1_PATH_SEGMENT vertexFlags) { }

    public void BeginFigure(D2D_POINT_2F startPoint, D2D1_FIGURE_BEGIN figureBegin)
    {
        Verbs.Add(0);
        Verbs.Add(startPoint.x + OffsetX);
        Verbs.Add(startPoint.y + OffsetY);
    }

    public void AddLines(D2D_POINT_2F[] points, uint pointsCount)
    {
        for (var i = 0; i < pointsCount; i++)
        {
            Verbs.Add(1);
            Verbs.Add(points[i].x + OffsetX);
            Verbs.Add(points[i].y + OffsetY);
        }
    }

    public void AddBeziers(D2D1_BEZIER_SEGMENT[] beziers, uint beziersCount)
    {
        for (var i = 0; i < beziersCount; i++)
        {
            var b = beziers[i];
            Verbs.Add(2);
            Verbs.Add(b.point1.x + OffsetX); Verbs.Add(b.point1.y + OffsetY);
            Verbs.Add(b.point2.x + OffsetX); Verbs.Add(b.point2.y + OffsetY);
            Verbs.Add(b.point3.x + OffsetX); Verbs.Add(b.point3.y + OffsetY);
        }
    }

    public void EndFigure(D2D1_FIGURE_END figureEnd)
    {
        if (figureEnd == D2D1_FIGURE_END.D2D1_FIGURE_END_CLOSED)
            Verbs.Add(3);
    }

    public HRESULT Close() => DirectN.Constants.S_OK;
}
