namespace NodeBox;

/// <summary>
/// Turns decoded NodeBox commands into Direct2D calls. One instance per frame.
///
/// PAINT — fill and stroke are brushes: a reusable solid brush each, or a
/// linear/radial gradient brush created from a FILLGRAD/STROKEGRAD op (owned by
/// this frame, disposed at the end). Gradient coordinates are in the shape's
/// local space, so they follow the transform like the shape does.
///
/// TRANSFORMS — applied natively: each shape is drawn in local coordinates with
/// its NodeBox matrix set on the target (composed with the surface base and the
/// device-pixel-ratio scale). Strokes, ovals and curves scale exactly (Quartz-like).
///
/// SHADOWS — when a shadow is set, each shape (fill + stroke together) is first
/// recorded into a D2D command list, run through the built-in Shadow effect and
/// drawn at the shadow offset, then the shape itself is drawn on top. Like
/// Quartz/NodeBox, the offset and blur are in canvas pixels and ignore the
/// current transform. Requires an ID2D1DeviceContext (AOTrino's surface is one).
/// </summary>
internal sealed class ID2D1RenderTarget_Proxy : IDisposable
{
    private readonly IComObject<ID2D1RenderTarget> _rt;
    private readonly ID2D1RenderTarget _raw;
    private readonly ID2D1DeviceContext? _dc;       // for shadows
    private readonly Matrix3x2 _surfaceBase;        // transform the surface had at frame start
    private readonly Matrix3x2 _base;               // DPR scale × surface base
    private readonly float _scale;                  // device pixel ratio
    private readonly List<IDisposable> _frameResources = [];
    private IComObject<ID2D1Factory>? _factory;     // lazily fetched for paths

    // Solid fill/stroke brushes are reused (SetColor) — except once a brush has been
    // recorded into a shadow command list: D2D replays command lists lazily and holds
    // brushes by reference, so the next colour change gets a fresh brush instead.
    private IComObject<ID2D1SolidColorBrush> _fillSolid;
    private IComObject<ID2D1SolidColorBrush> _strokeSolid;
    private bool _fillRecorded, _strokeRecorded;

    // Current shadow (null = none).
    private (float r, float g, float b, float a, float blur, float dx, float dy)? _shadow;

    /// <param name="scale">Device pixel ratio: NodeBox coordinates are CSS pixels,
    /// the surface renders at physical resolution.</param>
    public ID2D1RenderTarget_Proxy(IComObject<ID2D1RenderTarget> rt, float scale)
    {
        _rt  = rt;
        _raw = rt.Object;
        _dc  = rt.Object as ID2D1DeviceContext;
        _scale = scale;
        _raw.GetTransform(out var baseTransform);
        _surfaceBase = baseTransform;            // implicit D2D_MATRIX_3X2_F → Matrix3x2
        _base = Matrix3x2.CreateScale(scale) * _surfaceBase;
        _fillSolid   = rt.CreateSolidColorBrush(Color(0, 0, 0, 1));
        _strokeSolid = rt.CreateSolidColorBrush(Color(0, 0, 0, 1));
    }

    // ── Paint ──────────────────────────────────────────────────────────────

    public ID2D1Brush SolidFill(float r, float g, float b, float a)
    {
        if (_fillRecorded)
        {
            _frameResources.Add(_fillSolid);        // keep alive until the frame ends
            _fillSolid = _rt.CreateSolidColorBrush(Color(r, g, b, a));
            _fillRecorded = false;
        }
        else
        {
            _fillSolid.Object.SetColor(Color(r, g, b, a));
        }
        return (ID2D1Brush)_fillSolid.Object;
    }

    public ID2D1Brush SolidStroke(float r, float g, float b, float a)
    {
        if (_strokeRecorded)
        {
            _frameResources.Add(_strokeSolid);
            _strokeSolid = _rt.CreateSolidColorBrush(Color(r, g, b, a));
            _strokeRecorded = false;
        }
        else
        {
            _strokeSolid.Object.SetColor(Color(r, g, b, a));
        }
        return (ID2D1Brush)_strokeSolid.Object;
    }

    /// <param name="kind">0 linear (c0,c1 → c2,c3), 1 radial (centre c0,c1, radii c2,c3).</param>
    /// <param name="stops">(position, r, g, b, a) per stop, positions ascending in 0-1.</param>
    public ID2D1Brush Gradient(int kind, float c0, float c1, float c2, float c3,
        IReadOnlyList<(float t, float r, float g, float b, float a)> stops)
    {
        var d2dStops = new D2D1_GRADIENT_STOP[stops.Count];
        for (var i = 0; i < stops.Count; i++)
        {
            var s = stops[i];
            d2dStops[i] = new D2D1_GRADIENT_STOP { position = s.t, color = Color(s.r, s.g, s.b, s.a) };
        }

        var collection = _rt.CreateGradientStopCollection(d2dStops);
        _frameResources.Add(collection);

        if (kind == 1)
        {
            var radial = _rt.CreateRadialGradientBrush(new D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES
            {
                center  = Pt(c0, c1),
                radiusX = Math.Max(c2, 0.0001f),
                radiusY = Math.Max(c3, 0.0001f),
            }, collection);
            _frameResources.Add(radial);
            return (ID2D1Brush)radial.Object;
        }

        var linear = _rt.CreateLinearGradientBrush(new D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES
        {
            startPoint = Pt(c0, c1),
            endPoint   = Pt(c2, c3),
        }, collection);
        _frameResources.Add(linear);
        return (ID2D1Brush)linear.Object;
    }

    // ── Shadow state ───────────────────────────────────────────────────────

    public void SetShadow(float r, float g, float b, float a, float blur, float dx, float dy)
        => _shadow = (r, g, b, a, Math.Max(0, blur), dx, dy);

    public void ClearShadow() => _shadow = null;

    // ── Background ─────────────────────────────────────────────────────────

    // Clear ignores the world transform (and never casts a shadow).
    public void Clear(float r, float g, float b, float a)
        => _rt.Clear(Color(r, g, b, a));   // extension (raw Clear takes a pointer)

    // ── Shapes: fill and/or stroke, one shadow per shape ──────────────────

    public void Rect(double x, double y, double w, double h,
        ID2D1Brush? fill, ID2D1Brush? stroke, float sw, Matrix3x2 m)
    {
        var rect = MakeRect(x, y, w, h);
        Draw(m, () =>
        {
            if (fill != null)   _raw.FillRectangle(rect, fill);
            if (stroke != null) _raw.DrawRectangle(rect, stroke, sw, null);
        });
    }

    public void Ellipse(double x, double y, double w, double h,
        ID2D1Brush? fill, ID2D1Brush? stroke, float sw, Matrix3x2 m)
    {
        var e = MakeEllipse(x, y, w, h);
        Draw(m, () =>
        {
            if (fill != null)   _raw.FillEllipse(e, fill);
            if (stroke != null) _raw.DrawEllipse(e, stroke, sw, null);
        });
    }

    public void Line(double x1, double y1, double x2, double y2,
        ID2D1Brush stroke, float sw, Matrix3x2 m)
    {
        var p0 = Pt(x1, y1);
        var p1 = Pt(x2, y2);
        Draw(m, () => _raw.DrawLine(p0, p1, stroke, sw, null));
    }

    // ── Path ───────────────────────────────────────────────────────────────

    public void Path(List<PathVerb> verbs, bool close,
        ID2D1Brush? fill, ID2D1Brush? stroke, float sw, Matrix3x2 m)
    {
        // All COM objects live in DirectNAot ComObject<T> wrappers and are released
        // with Dispose(). (Marshal.ReleaseComObject does NOT work on ComWrappers/AOT
        // objects — it throws.)
        if (_factory == null)
        {
            _raw.GetFactory(out var rawFactory);
            _factory = new ComObject<ID2D1Factory>(rawFactory);
        }

        // Geometry is built in LOCAL coordinates; the matrix goes on the target.
        using var geometry = _factory.Object.CreatePathGeometry<ID2D1PathGeometry>();

        using (var sinkObj = geometry.Object.Open<ID2D1GeometrySink>())
        {
            var sink = sinkObj.Object;
            sink.SetFillMode(D2D1_FILL_MODE.D2D1_FILL_MODE_WINDING);
            var begin = fill == null ? D2D1_FIGURE_BEGIN.D2D1_FIGURE_BEGIN_HOLLOW
                                     : D2D1_FIGURE_BEGIN.D2D1_FIGURE_BEGIN_FILLED;

            // NodeBox pen semantics: lineto/curveto without a moveto start at the
            // current pen position; closepath closes the contour and returns the pen
            // to its start.
            var started = false;
            D2D_POINT_2F pen = default, figureStart = default;
            void EnsureFigure()
            {
                if (started) return;
                sink.BeginFigure(pen, begin);
                figureStart = pen;
                started = true;
            }

            foreach (var v in verbs)
            {
                switch (v.Cmd)
                {
                    case PathCmd.MoveTo:
                        if (started) sink.EndFigure(D2D1_FIGURE_END.D2D1_FIGURE_END_OPEN);
                        started = false;
                        pen = Pt(v.X1, v.Y1);
                        EnsureFigure();
                        break;

                    case PathCmd.LineTo:
                        EnsureFigure();
                        pen = Pt(v.X1, v.Y1);
                        sink.AddLine(pen);
                        break;

                    case PathCmd.CurveTo:
                        EnsureFigure();
                        var bez = new D2D1_BEZIER_SEGMENT
                        {
                            point1 = Pt(v.X1, v.Y1),
                            point2 = Pt(v.X2, v.Y2),
                            point3 = Pt(v.X3, v.Y3),
                        };
                        sink.AddBezier(ref bez);
                        pen = bez.point3;
                        break;

                    case PathCmd.Close:
                        if (started) sink.EndFigure(D2D1_FIGURE_END.D2D1_FIGURE_END_CLOSED);
                        started = false;
                        pen = figureStart;
                        break;
                }
            }

            if (started)
                sink.EndFigure(close ? D2D1_FIGURE_END.D2D1_FIGURE_END_CLOSED : D2D1_FIGURE_END.D2D1_FIGURE_END_OPEN);

            sink.Close().ThrowOnError();
        }

        var geom = (ID2D1Geometry)geometry.Object;
        Draw(m, () =>
        {
            if (fill != null)   _raw.FillGeometry(geom, fill, null!);
            if (stroke != null) _raw.DrawGeometry(geom, stroke, sw, null!);
        });
    }

    // ── Text ───────────────────────────────────────────────────────────────

    /// <param name="align">0 left, 1 right, 2 center, 3 justify.</param>
    /// <param name="width">Wrap width, or ≤ 0 for an unwrapped block anchored at x.</param>
    public void Text(string text, string font, float size, float lineHeight, int align,
        float x, float y, float width, ID2D1Brush fill, Matrix3x2 m)
    {
        if (text.Length == 0) return;
        var block = TextEngine.Get(text, font, size, lineHeight, align, width);

        // Without a wrap width, align() anchors the block at x.
        var left = x;
        if (width <= 0)
        {
            if (align == 2) left -= block.Width / 2;       // center
            else if (align == 1) left -= block.Width;      // right
        }

        var origin = Pt(left, y - block.Baseline);         // NodeBox y = first baseline
        var layout = block.Layout.Object;
        Draw(m, () => _raw.DrawTextLayout(origin, layout, fill,
            D2D1_DRAW_TEXT_OPTIONS.D2D1_DRAW_TEXT_OPTIONS_ENABLE_COLOR_FONT));
    }

    // ── Drawing core: shadow (optional) + shape ────────────────────────────

    private void Draw(Matrix3x2 m, Action draw)
    {
        if (_shadow is { } s && s.a > 0 && _dc != null)
            DrawShadow(m, draw, s);

        Apply(m);
        draw();
    }

    private void DrawShadow(Matrix3x2 m, Action draw,
        (float r, float g, float b, float a, float blur, float dx, float dy) s)
    {
        var dc = _dc!;

        // 1. Record the shape (with its transform) into a command list.
        //    (SetTarget may be called while drawing; the surface target is restored.)
        using var commandList = dc.CreateCommandList();
        using (var previous = dc.GetTarget<ID2D1Image>())
        {
            dc.SetTarget(commandList.Object);
            try
            {
                Apply(m);
                draw();
            }
            finally
            {
                if (previous != null)
                    dc.SetTarget(previous.Object);
            }
        }
        commandList.Object.Close().ThrowOnError();

        // The solid brushes are now referenced by the command list (see SolidFill).
        _fillRecorded = _strokeRecorded = true;

        // 2. A Shadow effect for this shape. (One per shape rather than one re-configured
        //    effect: D2D evaluates effect graphs lazily, so re-pointing a shared effect's
        //    input before the batch flushes could render the wrong shape.)
        using var shadowEffect = dc.CreateEffect(DirectN.Constants.CLSID_D2D1Shadow)
            ?? throw new InvalidOperationException("Direct2D Shadow effect unavailable.");
        var effect = shadowEffect.Object;

        // Canvas/NodeBox "blur" ≈ 2 × Gaussian standard deviation; device pixels.
        var sigma = s.blur * _scale / 2;
        effect.SetValue((uint)D2D1_SHADOW_PROP.D2D1_SHADOW_PROP_BLUR_STANDARD_DEVIATION,
            D2D1_PROPERTY_TYPE.D2D1_PROPERTY_TYPE_FLOAT, BitConverter.GetBytes(sigma));
        var rgba = new byte[16];
        BitConverter.TryWriteBytes(rgba.AsSpan(0),  s.r);
        BitConverter.TryWriteBytes(rgba.AsSpan(4),  s.g);
        BitConverter.TryWriteBytes(rgba.AsSpan(8),  s.b);
        BitConverter.TryWriteBytes(rgba.AsSpan(12), s.a);
        effect.SetValue((uint)D2D1_SHADOW_PROP.D2D1_SHADOW_PROP_COLOR,
            D2D1_PROPERTY_TYPE.D2D1_PROPERTY_TYPE_VECTOR4, rgba);
        effect.SetInput((ID2D1Image)commandList.Object, 0, false);

        // 3. Draw it offset in canvas pixels. The recorded content is already in
        //    device space, so only the (DPR-scaled) offset is applied.
        using var output = effect.GetOutput();
        D2D_MATRIX_3X2_F t = Matrix3x2.CreateTranslation(s.dx * _scale, s.dy * _scale);
        _raw.SetTransform(t);
        dc.DrawImage(output.Object);
    }

    // ── Lifetime ───────────────────────────────────────────────────────────

    // Restores the surface's original transform and releases per-frame resources.
    public void Dispose()
    {
        try
        {
            D2D_MATRIX_3X2_F t = _surfaceBase;
            _raw.SetTransform(t);
        }
        catch { /* never throw from the frame */ }

        foreach (var r in _frameResources) r.Dispose();
        _frameResources.Clear();
        _fillSolid.Dispose();
        _strokeSolid.Dispose();
        _factory?.Dispose();
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    // NodeBox matrix first, then the surface's base transform (row-vector convention).
    private void Apply(Matrix3x2 m)
    {
        D2D_MATRIX_3X2_F t = m * _base;
        _raw.SetTransform(t);
    }

    // NB: DirectN's D3DCOLORVALUE constructor is (a, r, g, b) — alpha FIRST.
    private static D3DCOLORVALUE Color(float r, float g, float b, float a) => new(a, r, g, b);

    // Normalises negative width/height (NodeBox allows them).
    private static D2D_RECT_F MakeRect(double x, double y, double w, double h) => new()
    {
        left   = (float)Math.Min(x, x + w),
        top    = (float)Math.Min(y, y + h),
        right  = (float)Math.Max(x, x + w),
        bottom = (float)Math.Max(y, y + h),
    };

    private static D2D1_ELLIPSE MakeEllipse(double x, double y, double w, double h) => new()
    {
        point   = Pt(x + w / 2, y + h / 2),
        radiusX = (float)Math.Abs(w / 2),
        radiusY = (float)Math.Abs(h / 2),
    };

    private static D2D_POINT_2F Pt(double x, double y) => new() { x = (float)x, y = (float)y };
}
