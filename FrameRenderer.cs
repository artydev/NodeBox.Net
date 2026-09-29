namespace NodeBox;

/// <summary>
/// Decodes one frame of NodeBox drawing commands and renders it with Direct2D.
///
/// The page records every NodeBox call into a Float32Array and sends it here
/// once per frame (base64 through the bridge) — so the cost of a frame is the
/// drawing, not hundreds of synchronous bridge round-trips.
///
/// Wire format (all float32, little-endian):
///
///   header : MAGIC(=7001) VERSION(=3) DPR
///   then a stream of ops, each an opcode followed by its operands:
///
///   0  CLEAR        r g b a
///   1  MATRIX       m11 m12 m21 m22 m31 m32    (NodeBox CTM, row-vector convention)
///   2  RECT         x y w h
///   3  OVAL         x y w h
///   4  LINE         x1 y1 x2 y2
///   5  PATH         nverbs close  { verb … }   verb = 0 x y | 1 x y | 2 c1x c1y c2x c2y x y | 3 (close contour)
///   6  FILL         r g b a
///   7  NOFILL
///   8  STROKE       r g b a
///   9  NOSTROKE
///   10 STROKEWIDTH  w
///   11 TEXT         str font size lineheight align x y width
///                   (str/font index the frame's string table; align 0 left
///                    1 right 2 center 3 justify; width ≤ 0 = no wrapping)
///
///   12 FILLGRAD     kind c0 c1 c2 c3 nstops { t r g b a … }
///   13 STROKEGRAD   (same operands)   kind 0 = linear (c0,c1)→(c2,c3)
///                                     kind 1 = radial centre (c0,c1) radii (c2,c3)
///   14 SHADOW       r g b a blur dx dy   (canvas pixels; ignores the transform)
///   15 NOSHADOW
///
/// Strings travel next to the float buffer as a separate table (see
/// DrawingApi.submit); TEXT refers to them by index.
///
/// Fill/stroke/matrix are STATE in the stream (emitted only when they change),
/// which keeps frames small. The decoder starts each frame with NodeBox defaults:
/// black fill, no stroke, stroke width 1, identity matrix, white canvas.
///
/// Must never throw: it runs between BeginDraw/EndDraw.
/// </summary>
internal static class FrameRenderer
{
    public const float Magic = 7001;
    public const float Version = 3;

    private enum Op
    {
        Clear = 0, Matrix = 1, Rect = 2, Oval = 3, Line = 4, Path = 5,
        Fill = 6, NoFill = 7, Stroke = 8, NoStroke = 9, StrokeWidth = 10,
        Text = 11, FillGradient = 12, StrokeGradient = 13, Shadow = 14, NoShadow = 15,
    }

    /// <returns>An error message, or null when the frame rendered cleanly.</returns>
    public static string? Render(IComObject<ID2D1RenderTarget> rt, byte[] frame, string[] strings)
    {
        string Str(float index)
        {
            var k = (int)index;
            return (uint)k < (uint)strings.Length ? strings[k] : string.Empty;
        }

        ReadOnlySpan<float> f = MemoryMarshal.Cast<byte, float>(frame);
        if (f.Length < 3 || f[0] != Magic || f[1] != Version)
            return "Invalid frame header.";

        var dpr = f[2] > 0 && float.IsFinite(f[2]) ? f[2] : 1f;

        ID2D1RenderTarget_Proxy p;
        try { p = new ID2D1RenderTarget_Proxy(rt, dpr); }
        catch (Exception ex) { return $"{ex.GetType().Name}: {ex.Message}"; }

        string? error = null;
        var i = 3;
        try
        {
            // State — NodeBox defaults: black fill, no stroke, width 1, identity, no shadow.
            ID2D1Brush? fill = p.SolidFill(0, 0, 0, 1);
            ID2D1Brush? stroke = null;
            float sw = 1;
            var m = Matrix3x2.Identity;

            p.Clear(1, 1, 1, 1); // NodeBox's default canvas is white.

            while (i < f.Length)
            {
                var op = (Op)(int)f[i++];
                switch (op)
                {
                    case Op.Clear:
                        p.Clear(f[i], f[i + 1], f[i + 2], f[i + 3]);
                        i += 4;
                        break;

                    case Op.Matrix:
                        m = new Matrix3x2(f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]);
                        i += 6;
                        break;

                    case Op.Rect:
                    {
                        float x = f[i], y = f[i + 1], w = f[i + 2], h = f[i + 3];
                        i += 4;
                        if (fill != null || stroke != null) p.Rect(x, y, w, h, fill, stroke, sw, m);
                        break;
                    }

                    case Op.Oval:
                    {
                        float x = f[i], y = f[i + 1], w = f[i + 2], h = f[i + 3];
                        i += 4;
                        if (fill != null || stroke != null) p.Ellipse(x, y, w, h, fill, stroke, sw, m);
                        break;
                    }

                    case Op.Line:
                        if (stroke != null) p.Line(f[i], f[i + 1], f[i + 2], f[i + 3], stroke, sw, m);
                        i += 4;
                        break;

                    case Op.Path:
                    {
                        var count = (int)f[i];
                        var close = f[i + 1] != 0;
                        i += 2;
                        var verbs = new List<PathVerb>(count);
                        for (var v = 0; v < count; v++)
                        {
                            var cmd = (PathCmd)(int)f[i++];
                            if (cmd == PathCmd.Close)
                            {
                                verbs.Add(new PathVerb(cmd, 0, 0));
                            }
                            else if (cmd == PathCmd.CurveTo)
                            {
                                verbs.Add(new PathVerb(cmd, f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]));
                                i += 6;
                            }
                            else
                            {
                                verbs.Add(new PathVerb(cmd, f[i], f[i + 1]));
                                i += 2;
                            }
                        }
                        if ((fill != null || stroke != null) && verbs.Count > 0)
                            p.Path(verbs, close, fill, stroke, sw, m);
                        break;
                    }

                    case Op.Fill:
                        fill = p.SolidFill(f[i], f[i + 1], f[i + 2], f[i + 3]);
                        i += 4;
                        break;

                    case Op.NoFill:
                        fill = null;
                        break;

                    case Op.Stroke:
                        stroke = p.SolidStroke(f[i], f[i + 1], f[i + 2], f[i + 3]);
                        i += 4;
                        break;

                    case Op.NoStroke:
                        stroke = null;
                        break;

                    case Op.FillGradient:
                    case Op.StrokeGradient:
                    {
                        var kind = (int)f[i];
                        float c0 = f[i + 1], c1 = f[i + 2], c2 = f[i + 3], c3 = f[i + 4];
                        var count = (int)f[i + 5];
                        i += 6;
                        var stops = new (float t, float r, float g, float b, float a)[count];
                        for (var k = 0; k < count; k++, i += 5)
                            stops[k] = (f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4]);
                        var brush = count > 0 ? p.Gradient(kind, c0, c1, c2, c3, stops) : null;
                        if (op == Op.FillGradient) fill = brush; else stroke = brush;
                        break;
                    }

                    case Op.Shadow:
                        p.SetShadow(f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5], f[i + 6]);
                        i += 7;
                        break;

                    case Op.NoShadow:
                        p.ClearShadow();
                        break;

                    case Op.Text:
                    {
                        var text = Str(f[i]);
                        var font = Str(f[i + 1]);
                        float size = f[i + 2], lh = f[i + 3];
                        var align = (int)f[i + 4];
                        float x = f[i + 5], y = f[i + 6], w = f[i + 7];
                        i += 8;
                        if (fill != null) p.Text(text, font, size, lh, align, x, y, w, fill, m);
                        break;
                    }

                    case Op.StrokeWidth:
                        sw = Math.Max(0, f[i++]);
                        break;

                    default:
                        return $"Unknown opcode {(int)op} at offset {i - 1}.";
                }
            }
        }
        catch (IndexOutOfRangeException)
        {
            error = $"Truncated frame at offset {i}.";
        }
        catch (Exception ex)
        {
            error = $"{ex.GetType().Name}: {ex.Message}";
        }
        finally
        {
            p.Dispose(); // restores the surface transform, releases the brush
        }

        return error;
    }
}

// ── Path verb ────────────────────────────────────────────────────────────────

internal enum PathCmd { MoveTo = 0, LineTo = 1, CurveTo = 2, Close = 3 }

internal readonly struct PathVerb(PathCmd cmd,
    float x1, float y1,
    float x2 = 0, float y2 = 0,
    float x3 = 0, float y3 = 0)
{
    public PathCmd Cmd { get; } = cmd;
    public float X1 { get; } = x1;
    public float Y1 { get; } = y1;
    public float X2 { get; } = x2;
    public float Y2 { get; } = y2;
    public float X3 { get; } = x3;
    public float Y3 { get; } = y3;
}
